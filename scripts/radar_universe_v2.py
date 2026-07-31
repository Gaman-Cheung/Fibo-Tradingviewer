"""Versioned Market Radar universe review, seed generation and read-only audit.

The committed CSV manifests are the review source of truth.  Runtime Radar
classification never calls the name-review helpers in this file; it imports
the generated, permanent Market+Code seeds instead.

Commands:
  bootstrap   Build v2 manifests from the current Supabase catalogs. This is a
              review-time operation and requires --force.
  generate    Validate the committed manifests and deterministically generate
              the two v2 Python seed modules.
  validate    Validate manifests and generated seeds without network access.
  dry-run     Read Supabase histories, rebuild v2 snapshots in memory and print
              a capacity/report JSON. No write-capable method is called.
"""
from __future__ import annotations

import argparse
import csv
from datetime import date
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pprint
import re
import sys
from typing import Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
UNIVERSE_DIR = SCRIPT_DIR / "universe"
INDEX_MANIFEST = UNIVERSE_DIR / "index_universe_v2.csv"
ETF_MANIFEST = UNIVERSE_DIR / "etf_universe_v2.csv"
INDEX_SEED = SCRIPT_DIR / "index_catalog_seed_v2.py"
ETF_SEED = SCRIPT_DIR / "etf_catalog_seed_v2.py"

UNIVERSE_VERSION = 2
INDEX_EXPECTED_COUNT = 507
ETF_EXPECTED_COUNT = 1615
REVIEW_DATE = "2026-07-31"
MIN_MATURE_SESSIONS = 62

INDEX_CATEGORIES = {"broad", "sector", "theme", "style", "strategy", "fund", "bond", "other"}
ETF_CATEGORIES = {
    "equity_broad", "equity_sector", "equity_theme", "equity_strategy",
    "overseas", "commodity", "bond", "money", "other",
}
ETF_SCOPES = {"EQUITY_ETF", "CROSS_ASSET"}

MANIFEST_FIELDS = (
    "market", "code", "name", "category", "radar_scope", "theme_group",
    "theme_label", "radar_enabled", "active_at_review",
    "history_from_at_review", "review_status", "source_url",
    "crosscheck_url", "reviewed_at", "exclusion_reason",
)

SOURCES = {
    "index_sh": "https://www.sse.com.cn/market/sseindex/indexlist/",
    "index_sz": "https://www.cnindex.com.cn/",
    "etf_sh": "https://www.sse.com.cn/assortment/fund/etf/list/",
    "etf_sz": "https://www.szse.cn/market/product/list/etfList/index.html",
    "index_crosscheck": "https://www.baostock.com/mainContent?file=indexData.md",
    "etf_crosscheck": "https://www.baostock.com/mainContent?file=DailyUpdates.md#query_daily_history_k_ETF",
}

# Permanent-code decisions for legacy names whose official short title is too
# terse for a safe generic review rule.  These are review-time decisions only;
# the generated runtime seed remains the sole classifier used by sync jobs.
INDEX_REVIEW_OVERRIDES = {
    "SH:000054": ("broad", "", "", False),             # 上证海外
    "SH:000062": ("style", "", "", False),             # 上证沪企
    "SH:000066": ("sector", "resources_industrial", "Resources & Industrial", True),
    "SH:000067": ("theme", "emerging_industries", "Emerging Industries", True),
    "SH:000091": ("broad", "", "", False),
    "SH:000093": ("style", "", "", False),
    "SH:000098": ("style", "", "", False),
    "SH:000099": ("style", "", "", False),
    "SH:000100": ("style", "", "", False),
    "SH:000102": ("sector", "industrial_goods", "Industrial Goods", True),
    "SH:000105": ("sector", "materials", "Materials", True),
    "SH:000107": ("sector", "consumer", "Consumer", True),
    "SH:000111": ("sector", "information_technology", "Information Technology", True),
    "SH:000113": ("sector", "utilities", "Utilities", True),
    "SH:000114": ("theme", "sustainable_industry", "Sustainable Industry", True),
    "SH:000131": ("theme", "high_technology", "High Technology", True),
    "SH:000132": ("broad", "", "", False),
    "SH:000133": ("broad", "", "", False),
    "SH:000146": ("sector", "manufacturing", "Manufacturing", True),
    "SH:000155": ("broad", "", "", False),
    "SH:000161": ("theme", "china_manufacturing", "China Manufacturing", True),
    "SH:000855": ("broad", "", "", False),
    "SH:000901": ("theme", "well_off_industry", "Well-off Industry", True),
    "SH:000959": ("broad", "", "", False),
    "SH:000964": ("theme", "emerging_industries", "Emerging Industries", True),
    "SH:000975": ("broad", "", "", False),
    "SZ:399010": ("broad", "", "", False),
    "SZ:399013": ("broad", "", "", False),
    "SZ:399015": ("broad", "", "", False),
    "SZ:399242": ("sector", "business_services", "Business Services", True),
    "SZ:399243": ("sector", "research_services", "Research Services", True),
    "SZ:399310": ("broad", "", "", False),
    "SZ:399312": ("broad", "", "", False),
    "SZ:399320": ("sector", "utilities", "Utilities", True),
    "SZ:399339": ("theme", "technology", "Technology", True),
    "SZ:399350": ("broad", "", "", False),
    "SZ:399355": ("broad", "", "", False),
    "SZ:399356": ("broad", "", "", False),
    "SZ:399357": ("broad", "", "", False),
    "SZ:399360": ("theme", "new_hardware", "New Hardware", True),
    "SZ:399392": ("theme", "emerging_industries", "Emerging Industries", True),
    "SZ:399410": ("broad", "", "", False),
    "SZ:399423": ("theme", "technology", "Technology", True),
    "SZ:399429": ("theme", "silk_road", "Silk Road", True),
    "SZ:399550": ("style", "", "", False),
    "SZ:399553": ("style", "", "", False),
    "SZ:399624": ("broad", "", "", False),
    "SZ:399625": ("broad", "", "", False),
    "SZ:399636": ("sector", "machinery", "Machinery", True),
    "SZ:399639": ("sector", "resources_industrial", "Resources & Industrial", True),
    "SZ:399641": ("theme", "emerging_industries", "Emerging Industries", True),
    "SZ:399642": ("theme", "emerging_industries", "Emerging Industries", True),
    "SZ:399643": ("theme", "emerging_industries", "Emerging Industries", True),
    "SZ:399652": ("theme", "high_technology", "High Technology", True),
    "SZ:399678": ("style", "", "", False),
    "SZ:399679": ("broad", "", "", False),
    "SZ:399901": ("theme", "well_off_industry", "Well-off Industry", True),
    "SZ:399974": ("theme", "state_owned_reform", "State-owned Reform", True),
    "SZ:399992": ("strategy", "", "", False),
}

ETF_REVIEW_OVERRIDES = {
    # BaoStock returned only the provider code for these inactive listings.
    # They remain explicitly reviewed raw records until an official name can
    # be evidenced in a later Universe review.
    "SH:560000": ("other", None, "", ""),
    "SH:560650": ("other", None, "", ""),
    "SH:560890": ("other", None, "", ""),
    "SZ:159969": ("other", None, "", ""),
}


def _text(value) -> str:
    return str(value or "").strip()


def _bool(value) -> bool:
    return value is True or _text(value).lower() in {"1", "true", "yes"}


def _symbol_key(row: dict) -> str:
    return f"{_text(row.get('market')).upper()}:{_text(row.get('code'))}"


def _slug(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return normalized or "exposure"


def _fallback_group(label: str) -> str:
    digest = hashlib.sha1(label.encode("utf-8")).hexdigest()[:12]
    return f"exposure_{digest}"


def _first_rule(name: str, rules: Iterable[tuple[str, str, tuple[str, ...]]]):
    for group, label, needles in rules:
        if any(needle in name for needle in needles):
            return group, label
    return None


COMMON_THEME_RULES = (
    ("ai_computing", "AI & Computing", ("人工智能", "算力", "AI产业", "AI主题")),
    ("semiconductor", "Semiconductor", ("半导体", "芯片", "集成电路")),
    ("cloud_computing", "Cloud Computing", ("云计算",)),
    ("software", "Software", ("软件", "计算机", "工业互联网")),
    ("internet_of_things", "Internet of Things", ("物联网", "车联网")),
    ("information_innovation", "Information Innovation", ("信创",)),
    ("virtual_reality", "Virtual Reality", ("虚拟现实",)),
    ("5g", "5G", ("5G",)),
    ("data_digital", "Data & Digital", ("数据要素", "数字经济", "大数据", "数字中国")),
    ("cybersecurity", "Cybersecurity", ("网络安全", "信息安全")),
    ("robotics", "Robotics", ("机器人",)),
    ("consumer_electronics", "Consumer Electronics", ("消费电子", "智能家居")),
    ("gaming", "Gaming", ("游戏", "动漫")),
    ("media", "Media", ("传媒", "影视", "文化娱乐")),
    ("communications", "Communications", ("通信", "电信")),
    ("information_technology", "Information Technology", ("信息技术", "信息产业", "TMT", "电子")),
    ("technology", "Technology", ("科技",)),
    ("defense", "Defense", ("军工", "国防", "航空航天")),
    ("satellite_space", "Satellite & Space", ("卫星", "商业航天")),
    ("low_altitude", "Low-altitude Economy", ("低空经济",)),
    ("new_energy_vehicle", "New Energy Vehicle", ("新能源汽车", "新能源车", "智能汽车")),
    ("automobile", "Automobile", ("汽车",)),
    ("battery", "Battery", ("电池", "锂电")),
    ("solar", "Solar", ("光伏", "太阳能")),
    ("wind_power", "Wind Power", ("风电",)),
    ("green_power", "Green Power", ("绿色电力",)),
    ("new_energy", "New Energy", ("新能源", "清洁能源", "绿色能源")),
    ("low_carbon", "Low Carbon", ("低碳",)),
    ("carbon_neutral", "Carbon Neutral", ("碳中和", "碳科技", "碳效率")),
    ("environmental", "Environmental", ("环保", "生态", "绿色产业")),
    ("innovative_drugs", "Innovative Drugs", ("创新药",)),
    ("biotechnology", "Biotechnology", ("生物科技", "生物医药", "生物产业", "疫苗")),
    ("medical_devices", "Medical Devices", ("医疗器械",)),
    ("medical_services", "Medical Services", ("医疗服务",)),
    ("traditional_medicine", "Traditional Medicine", ("中药",)),
    ("healthcare", "Healthcare", ("医药", "医疗", "健康", "卫生", "制药")),
    ("liquor", "Liquor", ("白酒", "酒ETF", "酒指数", "酒产业")),
    ("food_beverage", "Food & Beverage", ("食品饮料", "食品", "饮料", "乳业")),
    ("agriculture", "Agriculture", ("农业", "农牧渔", "粮食")),
    ("livestock", "Livestock", ("畜牧", "养殖", "生猪")),
    ("consumer", "Consumer", ("主要消费", "可选消费", "消费服务", "消费龙头", "消费")),
    ("tourism", "Tourism", ("旅游", "酒店", "餐饮")),
    ("retail", "Retail", ("零售", "商业贸易", "商贸")),
    ("home_appliance", "Home Appliance", ("家用电器", "家电", "家居")),
    ("banking", "Banking", ("银行",)),
    ("securities", "Securities", ("证券公司", "证券", "券商")),
    ("insurance", "Insurance", ("保险",)),
    ("fintech", "Fintech", ("金融科技",)),
    ("finance", "Finance", ("非银金融", "金融地产", "金融")),
    ("real_estate", "Real Estate", ("房地产", "地产")),
    ("utilities", "Utilities", ("公用事业", "水电煤气", "电力")),
    ("oil_gas", "Oil & Gas", ("石油天然气", "油气", "石化", "能源行业")),
    ("energy", "Energy", ("能源ETF", "能源指数", "全指能源")),
    ("gold_mining", "Gold Industry", ("黄金产业", "黄金股票")),
    ("coal", "Coal", ("煤炭", "煤炭开采")),
    ("rare_metals", "Rare Metals", ("稀有金属", "稀土")),
    ("nonferrous_metals", "Non-ferrous Metals", ("有色金属矿业", "工业有色金属", "有色金属", "有色")),
    ("steel", "Steel", ("钢铁",)),
    ("chemicals", "Chemicals", ("细分化工", "化工产业", "化工")),
    ("materials", "Materials", ("原材料", "材料行业", "建材", "新材料")),
    ("machinery", "Machinery", ("工程机械", "机械设备", "高端装备", "装备产业", "工业母机", "机床")),
    ("construction", "Construction", ("建筑", "基建", "一带一路", "高铁")),
    ("transportation", "Transportation", ("交通运输", "运输", "物流", "港口", "铁路", "航空运输")),
    ("shipping", "Shipping", ("航运", "船舶")),
    ("aerospace", "Aerospace", ("航空产业", "航空")),
    ("sports", "Sports", ("体育",)),
    ("elderly_care", "Elderly Care", ("养老",)),
)

STRATEGY_RULES = (
    ("free_cash_flow", "Free Cash Flow", ("自由现金流",)),
    ("dividend_low_vol", "Dividend Low Vol", ("红利低波", "低波红利")),
    ("dividend_quality", "Dividend Quality", ("红利质量",)),
    ("dividend", "Dividend", ("红利", "高股息", "股息")),
    ("low_volatility", "Low Volatility", ("低波动", "低波")),
    ("value", "Value", ("价值",)),
    ("growth", "Growth", ("成长",)),
    ("quality", "Quality", ("质量",)),
    ("esg", "ESG", ("ESG", "责任", "可持续")),
    ("fundamental", "Fundamental", ("基本面",)),
    ("equal_weight", "Equal Weight", ("等权",)),
    ("enhanced", "Enhanced", ("增强策略", "增强ETF", "增强型")),
    ("central_soe", "Central SOE", ("央企", "国企改革", "国有企业改革", "国企")),
    ("private_enterprise", "Private Enterprise", ("民企", "民营")),
    ("innovation_strategy", "Innovation", ("创新领先", "科技创新")),
    ("core_competitiveness", "Core Competitiveness", ("核心竞争力",)),
    ("cctv_finance", "CCTV Finance", ("央视财经",)),
)

BROAD_RULES = (
    ("csi_a500", "CSI A500", ("中证A500", "A500ETF", "A500指数")),
    ("csi_a100", "CSI A100", ("中证A100",)),
    ("csi_a50", "CSI A50", ("中证A50",)),
    ("csi300", "CSI 300", ("沪深300",)),
    ("csi500", "CSI 500", ("中证500",)),
    ("csi1000", "CSI 1000", ("中证1000",)),
    ("csi2000", "CSI 2000", ("中证2000",)),
    ("cni2000", "CNI 2000", ("国证2000",)),
    ("csi800", "CSI 800", ("中证800",)),
    ("sse50", "SSE 50", ("上证50",)),
    ("sse180", "SSE 180", ("上证180",)),
    ("sse380", "SSE 380", ("上证380",)),
    ("sse_composite", "SSE Composite", ("上证综合", "上证综指")),
    ("star200", "STAR 200", ("科创板200", "科创200")),
    ("star100", "STAR 100", ("科创板100", "科创100")),
    ("star50", "STAR 50", ("科创板50", "科创50")),
    ("star_composite", "STAR Composite", ("科创板综合", "科创综指")),
    ("chinext50", "ChiNext 50", ("创业板50",)),
    ("star_chinext50", "STAR ChiNext 50", ("科创创业50", "双创50")),
    ("chinext200", "ChiNext 200", ("创业板200",)),
    ("chinext300", "ChiNext 300", ("创业板300",)),
    ("chinext", "ChiNext", ("创业板ETF", "创业板指", "创业板综合", "创业板综", "创业板大盘")),
    ("szse100", "SZSE 100", ("深证100",)),
    ("szse50", "SZSE 50", ("深证50",)),
    ("szse_component", "SZSE Component", ("深证成指", "深证成份")),
    ("szse_main50", "SZSE Main Board 50", ("深证主板50",)),
    ("szse300", "SZSE 300", ("深证300",)),
    ("sme100", "SME 100", ("中小企业100", "中小100")),
    ("sme400", "SME 400", ("中创400",)),
    ("sse580", "SSE 580", ("上证580",)),
    ("sse_large", "SSE Large Cap", ("上证超大盘", "上证中盘")),
    ("a_share", "A Share", ("中证A股", "A股ETF", "A股指数")),
    ("msci_china_a50", "MSCI China A50", ("MSCI中国A50",)),
    ("msci_china_a", "MSCI China A", ("MSCI中国A股",)),
    ("ftse_china_a50", "FTSE China A50", ("富时中国A50",)),
    ("cni50", "CNI 50", ("国证50",)),
    ("cni100", "CNI 100", ("国证100",)),
    ("cni1000", "CNI 1000", ("国证1000",)),
)


def _normalize_exposure_name(name: str) -> str:
    value = re.sub(r"[（(].*?[）)]", "", name)
    value = re.sub(r"(?:QDII[-－]?)?ETF[A-Z]*$", "", value, flags=re.IGNORECASE)
    value = value.replace("交易型开放式指数证券投资基金", "").replace("发起式", "")
    markers = (
        "中证", "国证", "上证", "深证", "沪深", "创业板", "科创", "恒生",
        "港股通", "MSCI", "纳斯达克", "标普", "日经", "富时", "黄金",
        "国债", "地方政府债", "公司债", "政策性金融债", "政金债", "可转债",
        "城投债", "信用债", "货币", "保证金", "豆粕", "能源化工", "A股",
    )
    positions = [value.find(marker) for marker in markers if value.find(marker) >= 0]
    if positions:
        value = value[min(positions):]
    value = re.sub(r"(?:指数)?ETF.*$", "", value, flags=re.IGNORECASE)
    value = value.strip(" -·（）()")
    return value[:40] or name[:40]


def _classify_cross_asset(name: str):
    if any(token in name for token in (
        "货币", "保证金", "收益宝", "天天金", "快线", "日鑫", "日利", "日盈", "添益",
    )):
        return "money", "CROSS_ASSET", "money_market", "Money Market"
    if any(token in name for token in (
        "国债", "地方政府债", "公司债", "政金债", "政策性金融债", "可转债",
        "城投债", "信用债", "债券ETF", "短债", "短融", "债利差", "投资级债",
        "国开债", "国开行", "科创债",
    )):
        rules = (
            ("local_government_bond_10y", "10Y Local Government Bond", ("10年期地方政府债",)),
            ("local_government_bond_5y", "5Y Local Government Bond", ("5年期地方政府债",)),
            ("local_government_bond_0_4y", "0-4Y Local Government Bond", ("0-4年地方政府债",)),
            ("tech_innovation_bond", "Tech Innovation Bond", ("科技创新公司债", "科创公司债", "科创债")),
            ("government_policy_bond_0_3y", "0-3Y Government & Policy Bond", ("国债及政策性金融债0-3年",)),
            ("policy_financial_bond_0_3y", "0-3Y Policy Financial Bond", ("0-3年国开", "0-3年政策性金融债")),
            ("policy_financial_bond_1_5y", "1-5Y Policy Financial Bond", ("1-5年国开", "1-5年政策性金融债")),
            ("policy_financial_bond_7_10y", "7-10Y Policy Financial Bond", ("7-10年政策性金融债", "7-10年政金债")),
            ("treasury_30y", "30Y Treasury", ("30年", "三十年")),
            ("treasury_7_10y", "7-10Y Treasury", ("7-10年", "七至十年")),
            ("treasury_5_10y", "5-10Y Treasury", ("5-10年", "五至十年")),
            ("treasury_10y", "10Y Treasury", ("10年", "十年")),
            ("treasury_5y", "5Y Treasury", ("5年", "五年")),
            ("bond_0_3y", "0-3Y Bond", ("0-3年", "短债", "短融")),
            ("local_government_bond", "Local Government Bond", ("地方政府债",)),
            ("convertible_bond", "Convertible Bond", ("可转债",)),
            ("urban_investment_bond", "Urban Investment Bond", ("城投债",)),
            ("policy_financial_bond", "Policy Financial Bond", ("政策性金融债", "政金债")),
            ("corporate_bond", "Corporate Bond", ("公司债",)),
            ("credit_bond", "Credit Bond", ("信用债", "投资级债", "债利差")),
        )
        match = _first_rule(name, rules)
        return "bond", "CROSS_ASSET", *(match or ("bond_market", "Bond Market"))
    commodity_rules = (
        ("gold", "Gold", ("上海金",)),
        ("silver", "Silver", ("白银",)),
        ("crude_oil", "Crude Oil", ("原油",)),
        ("soybean_meal", "Soybean Meal", ("豆粕",)),
        ("energy_chemical_futures", "Energy Chemicals", ("能源化工",)),
        ("nonferrous_futures", "Non-ferrous Futures", ("有色金属期货", "有色期货")),
    )
    commodity = _first_rule(name, commodity_rules)
    if not commodity and "黄金" in name and "黄金产业" not in name and "黄金股票" not in name:
        commodity = ("gold", "Gold")
    if commodity:
        return "commodity", "CROSS_ASSET", *commodity
    overseas_tokens = (
        "QDII", "恒生", "恒指", "港股", "香港", "沪港深", "沪深港", "纳斯达克", "纳指", "NASDAQ", "标普",
        "日经", "德国", "法国", "沙特", "印度", "越南", "东南亚", "韩国", "巴西",
        "新加坡", "美国", "海外", "中概互联网", "中国互联网50",
    )
    domestic_a_share = "中国A股" in name and "QDII" not in name and "港" not in name
    if not domestic_a_share and any(token.lower() in name.lower() for token in overseas_tokens):
        rules = (
            ("hk_gold_industry", "HK/CN Gold Industry", ("沪深港黄金产业",)),
            ("hang_seng_internet", "HK Internet", ("恒生互联网", "港股通互联网", "沪港深互联网", "香港互联网", "中概互联网", "中国互联网50", "海外中国互联网", "全球中国互联网")),
            ("hang_seng_tech", "Hang Seng Tech", ("恒生科技", "港股通科技", "香港科技")),
            ("hk_information_technology", "HK Information Technology", ("港股通信息技术",)),
            ("hk_cloud_computing", "HK Cloud Computing", ("沪港深云计算",)),
            ("hk_healthcare", "HK Healthcare", ("恒生医疗", "恒生生物", "香港创新药", "港股通创新药", "沪港深创新药", "港股通医疗", "港股通医药")),
            ("hk_consumer", "HK Consumer", ("港股通消费", "恒生消费")),
            ("hk_finance", "HK Finance", ("港股通金融", "香港证券", "恒生中国央企")),
            ("hk_automobile", "HK Automobile", ("港股通汽车",)),
            ("hk_dividend", "HK Dividend", ("港股通高股息", "港股高股息", "港股通红利", "港股通央企红利", "港股通低波红利", "恒生红利")),
            ("hk_cn_broad", "HK/CN Broad", ("沪港深500", "沪港深300")),
            ("hang_seng", "Hang Seng", ("恒生", "恒指", "港股通50", "港股通精选")),
            ("nasdaq100", "NASDAQ 100", ("纳斯达克100", "纳指100", "NASDAQ100")),
            ("sp500", "S&P 500", ("标普500",)),
            ("nikkei225", "Nikkei 225", ("日经225",)),
            ("germany_equity", "Germany Equity", ("德国", "DAX")),
            ("france_equity", "France Equity", ("法国", "CAC40")),
            ("saudi_equity", "Saudi Equity", ("沙特",)),
            ("india_equity", "India Equity", ("印度",)),
            ("vietnam_equity", "Vietnam Equity", ("越南",)),
            ("brazil_equity", "Brazil Equity", ("巴西",)),
            ("southeast_asia", "Southeast Asia", ("东南亚", "新加坡")),
            ("korea_equity", "Korea Equity", ("韩国",)),
        )
        match = _first_rule(name, rules)
        if match:
            return "overseas", "CROSS_ASSET", *match
        label = _normalize_exposure_name(name)
        return "overseas", "CROSS_ASSET", _fallback_group(label), label
    return None


def classify_etf_review(name: str, key: str = "") -> tuple[str, str | None, str, str]:
    if key in ETF_REVIEW_OVERRIDES:
        return ETF_REVIEW_OVERRIDES[key]
    cross_asset = _classify_cross_asset(name)
    if cross_asset:
        return cross_asset
    strategy = _first_rule(name, STRATEGY_RULES)
    if strategy:
        return "equity_strategy", "EQUITY_ETF", *strategy
    theme = _first_rule(name, COMMON_THEME_RULES)
    if theme:
        sector_groups = {
            "software", "media", "communications", "information_technology", "automobile",
            "healthcare", "food_beverage", "agriculture", "livestock", "consumer", "retail",
            "home_appliance", "banking", "securities", "insurance", "finance", "real_estate",
            "utilities", "oil_gas", "coal", "nonferrous_metals", "steel", "chemicals",
            "materials", "machinery", "transportation", "shipping", "aerospace", "energy",
        }
        category = "equity_sector" if theme[0] in sector_groups else "equity_theme"
        return category, "EQUITY_ETF", *theme
    # Broad markers are deliberately checked after sector/theme markers:
    # "CSI 500 Information Technology" and "CSI 300 Healthcare" are sector
    # exposures, not broad-market funds merely because the parent index name is
    # present in the official title.
    broad = _first_rule(name, BROAD_RULES)
    if broad:
        return "equity_broad", "EQUITY_ETF", *broad
    label = _normalize_exposure_name(name)
    return "equity_theme", "EQUITY_ETF", _fallback_group(label), label


def classify_index_review(
    name: str, previous: tuple | None = None, key: str = ""
) -> tuple[str, str, str, bool]:
    if key in INDEX_REVIEW_OVERRIDES:
        return INDEX_REVIEW_OVERRIDES[key]
    previous = previous or (name, "other", "", "", False)
    _, old_category, old_group, old_label, _ = previous
    if old_category != "other":
        return old_category, old_group, old_label, old_category in {"sector", "theme"}
    theme = _first_rule(name, COMMON_THEME_RULES)
    if theme:
        sector_groups = {
            "software", "media", "communications", "information_technology", "automobile",
            "healthcare", "food_beverage", "agriculture", "livestock", "consumer", "retail",
            "home_appliance", "banking", "securities", "insurance", "finance", "real_estate",
            "utilities", "oil_gas", "coal", "nonferrous_metals", "steel", "chemicals",
            "materials", "machinery", "transportation", "shipping", "aerospace", "energy",
        }
        category = "sector" if theme[0] in sector_groups else "theme"
        return category, theme[0], theme[1], True
    if any(token in name for token in ("能源", "资源", "上游", "中游", "下游", "商品股票", "采矿", "制造业")):
        return "sector", "resources_industrial", "Resources & Industrial", True
    if _first_rule(name, BROAD_RULES) or any(token in name for token in (
        "综合指数", "成份指数", "大盘", "中盘", "小盘", "全指", "100指数", "200指数",
        "300价格", "500沪市", "基础市场", "创业板300", "A100",
    )):
        return "broad", "", "", False
    if _first_rule(name, STRATEGY_RULES) or any(token in name for token in (
        "央企", "国企", "民企", "沪股通", "绩效", "基本", "波动", "等权", "龙头",
        "周期", "防御", "ESG", "治理", "责任", "GDP", "投资时钟", "定向增发",
    )):
        return "style", "", "", False
    if any(token in name for token in ("债", "信用", "票据")):
        return "bond", "", "", False
    if "基金" in name or "ETF指数" in name:
        return "fund", "", "", False
    return "other", "", "", False


def _load_env() -> None:
    path = REPO_ROOT / ".env.local"
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _write_manifest(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=MANIFEST_FIELDS, lineterminator="\n")
        writer.writeheader()
        for row in sorted(rows, key=lambda item: (item["market"], item["code"])):
            writer.writerow({field: row.get(field, "") for field in MANIFEST_FIELDS})


def load_manifest(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def validate_manifest(rows: list[dict], kind: str) -> list[str]:
    expected = INDEX_EXPECTED_COUNT if kind == "index" else ETF_EXPECTED_COUNT
    categories = INDEX_CATEGORIES if kind == "index" else ETF_CATEGORIES
    errors: list[str] = []
    if len(rows) != expected:
        errors.append(f"{kind}: expected {expected} rows, found {len(rows)}")
    seen: set[str] = set()
    for position, row in enumerate(rows, 2):
        key = _symbol_key(row)
        prefix = f"{kind} row {position} ({key})"
        if key in seen:
            errors.append(f"{prefix}: duplicate permanent market code")
        seen.add(key)
        if row.get("market") not in {"SH", "SZ"} or not re.fullmatch(r"\d{6}", row.get("code", "")):
            errors.append(f"{prefix}: invalid Market/Code")
        if not _text(row.get("name")):
            errors.append(f"{prefix}: missing official name")
        if row.get("category") not in categories:
            errors.append(f"{prefix}: invalid category {row.get('category')!r}")
        if row.get("review_status") != "reviewed":
            errors.append(f"{prefix}: review_status must be reviewed")
        if row.get("reviewed_at") != REVIEW_DATE:
            errors.append(f"{prefix}: reviewed_at must be {REVIEW_DATE}")
        for source_field in ("source_url", "crosscheck_url"):
            if not _text(row.get(source_field)).startswith("https://"):
                errors.append(f"{prefix}: missing HTTPS {source_field}")
        enabled = _bool(row.get("radar_enabled"))
        if enabled and (not _text(row.get("theme_group")) or not _text(row.get("theme_label"))):
            errors.append(f"{prefix}: enabled row needs Theme Group and label")
        if not enabled and not _text(row.get("exclusion_reason")):
            errors.append(f"{prefix}: disabled row needs an exclusion reason")
        if kind == "index":
            expected_scope = "SECTOR_INDEX" if enabled else ""
            if _text(row.get("radar_scope")) != expected_scope:
                errors.append(f"{prefix}: invalid index Radar scope")
            if enabled and row.get("category") not in {"sector", "theme"}:
                errors.append(f"{prefix}: only sector/theme may be enabled")
        else:
            scope = _text(row.get("radar_scope"))
            if row.get("category") == "other":
                if scope or enabled:
                    errors.append(f"{prefix}: other ETF must be raw-only")
            elif scope not in ETF_SCOPES:
                errors.append(f"{prefix}: classified ETF needs a valid scope")
            expected_scope = "EQUITY_ETF" if row.get("category", "").startswith("equity_") else "CROSS_ASSET"
            if row.get("category") != "other" and scope != expected_scope:
                errors.append(f"{prefix}: category/scope mismatch")
    return errors


def _seed_dict(rows: list[dict], kind: str) -> dict[str, tuple]:
    result = {}
    for row in rows:
        key = _symbol_key(row)
        if kind == "index":
            result[key] = (
                row["name"], row["category"], row["theme_group"],
                row["theme_label"], _bool(row["radar_enabled"]),
            )
        else:
            result[key] = (
                row["name"], row["category"], row["radar_scope"] or None,
                row["theme_group"], row["theme_label"], _bool(row["radar_enabled"]),
            )
    return dict(sorted(result.items()))


def _render_seed(kind: str, values: dict[str, tuple]) -> str:
    constant = "INDEX_CATALOG_SEED_V2" if kind == "index" else "ETF_CATALOG_SEED_V2"
    source = INDEX_MANIFEST.name if kind == "index" else ETF_MANIFEST.name
    tuple_description = (
        "(reviewed_name, category, theme_group, theme_label, enabled)"
        if kind == "index" else
        "(reviewed_name, category, radar_scope, theme_group, theme_label, enabled)"
    )
    return (
        f'"""Generated Market Radar Universe v2 seed.\n\n'
        f"Source: scripts/universe/{source}\n"
        f"Tuple: {tuple_description}\n"
        f'This file is generated; edit the reviewed manifest, not this module.\n"""\n\n'
        f"{constant} = {pprint.pformat(values, sort_dicts=True, width=120)}\n"
    )


def generate_seeds(write: bool = True) -> dict[str, str]:
    index_rows = load_manifest(INDEX_MANIFEST)
    etf_rows = load_manifest(ETF_MANIFEST)
    errors = validate_manifest(index_rows, "index") + validate_manifest(etf_rows, "etf")
    if errors:
        raise ValueError("Universe manifest validation failed:\n- " + "\n- ".join(errors[:100]))
    rendered = {
        "index": _render_seed("index", _seed_dict(index_rows, "index")),
        "etf": _render_seed("etf", _seed_dict(etf_rows, "etf")),
    }
    if write:
        INDEX_SEED.write_text(rendered["index"], encoding="utf-8", newline="\n")
        ETF_SEED.write_text(rendered["etf"], encoding="utf-8", newline="\n")
    return rendered


def _catalog_review_rows(db, kind: str) -> list[dict]:
    if kind == "index":
        return db.get_index_catalog()
    return db.get_etf_catalog()


def bootstrap_manifests(force: bool = False) -> None:
    if not force:
        raise ValueError("bootstrap requires --force; committed review manifests must not be overwritten accidentally")
    _load_env()
    sys.path.insert(0, str(SCRIPT_DIR))
    from sync_baostock import SupabaseRest
    from index_catalog_seed_v1 import INDEX_CATALOG_SEED_V1

    db = SupabaseRest()
    index_catalog = _catalog_review_rows(db, "index")
    etf_catalog = _catalog_review_rows(db, "etf")
    if len(index_catalog) != INDEX_EXPECTED_COUNT or len(etf_catalog) != ETF_EXPECTED_COUNT:
        raise RuntimeError(
            f"Catalog count drift: indices={len(index_catalog)}, ETFs={len(etf_catalog)}; "
            "review the new official universe before creating v2."
        )

    benchmark_response = db._request(
        "GET", "market_daily_bar",
        params={
            "select": "trade_date", "provider": "eq.baostock", "market": "eq.SH",
            "code": "eq.000300", "trade_status": "eq.true", "order": "trade_date.desc",
            "limit": "400",
        },
    )
    benchmark_dates = sorted({str(row.get("trade_date")) for row in benchmark_response.json()})
    if len(benchmark_dates) < MIN_MATURE_SESSIONS:
        raise RuntimeError("CSI300 history is too short to determine the 62-session review cutoff")
    maturity_cutoff = benchmark_dates[-MIN_MATURE_SESSIONS]
    etf_coverage_start = min(
        _text(row.get("history_from")) for row in etf_catalog if _text(row.get("history_from"))
    )

    index_rows = []
    for item in index_catalog:
        key = _symbol_key(item)
        name = _text(item.get("name"))
        category, group, label, enabled = classify_index_review(name, INDEX_CATALOG_SEED_V1.get(key), key)
        exclusion = "" if enabled else (
            "reviewed_unclassifiable_composite" if category == "other" else "outside_sector_theme_scope"
        )
        index_rows.append({
            "market": item["market"], "code": item["code"], "name": name,
            "category": category, "radar_scope": "SECTOR_INDEX" if enabled else "",
            "theme_group": group, "theme_label": label, "radar_enabled": str(enabled).lower(),
            "active_at_review": str(bool(item.get("active", True))).lower(),
            "history_from_at_review": _text(item.get("history_from")), "review_status": "reviewed",
            "source_url": SOURCES["index_sh" if item["market"] == "SH" else "index_sz"],
            "crosscheck_url": SOURCES["index_crosscheck"], "reviewed_at": REVIEW_DATE,
            "exclusion_reason": exclusion,
        })

    etf_rows = []
    for item in etf_catalog:
        name = _text(item.get("name"))
        key = _symbol_key(item)
        category, scope, group, label = classify_etf_review(name, key)
        history_from = _text(item.get("history_from"))
        # Universe v2 publication keeps at least 60 compatible historical
        # snapshots. A fund that joined during the retained window is fully
        # classified but deferred to a later Universe review; enabling it now
        # would create a legitimate pre-listing coverage hole during rebuild.
        mature = bool(
            history_from and history_from == etf_coverage_start and history_from <= maturity_cutoff
        )
        enabled = category != "other" and mature
        exclusion = "" if enabled else (
            "official_name_unavailable_in_current_catalog" if key in ETF_REVIEW_OVERRIDES else
            "reviewed_not_a_supported_radar_asset" if category == "other" else
            "partial_144_session_history_at_review"
        )
        etf_rows.append({
            "market": item["market"], "code": item["code"], "name": name,
            "category": category, "radar_scope": scope or "", "theme_group": group,
            "theme_label": label, "radar_enabled": str(enabled).lower(),
            "active_at_review": str(bool(item.get("active", True))).lower(),
            "history_from_at_review": history_from, "review_status": "reviewed",
            "source_url": SOURCES["etf_sh" if item["market"] == "SH" else "etf_sz"],
            "crosscheck_url": SOURCES["etf_crosscheck"], "reviewed_at": REVIEW_DATE,
            "exclusion_reason": exclusion,
        })

    _write_manifest(INDEX_MANIFEST, index_rows)
    _write_manifest(ETF_MANIFEST, etf_rows)
    generate_seeds(write=True)
    print(json.dumps({
        "index_rows": len(index_rows), "etf_rows": len(etf_rows),
        "maturity_cutoff": maturity_cutoff, "etf_coverage_start": etf_coverage_start,
        "index_enabled": sum(_bool(row["radar_enabled"]) for row in index_rows),
        "etf_enabled": sum(_bool(row["radar_enabled"]) for row in etf_rows),
    }, ensure_ascii=False, indent=2))


def _load_generated(path: Path, constant: str):
    spec = importlib.util.spec_from_file_location(f"_audit_{path.stem}", path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return getattr(module, constant)


def validate_all() -> dict:
    index_rows = load_manifest(INDEX_MANIFEST)
    etf_rows = load_manifest(ETF_MANIFEST)
    errors = validate_manifest(index_rows, "index") + validate_manifest(etf_rows, "etf")
    expected_render = generate_seeds(write=False) if not errors else None
    if not errors:
        if not INDEX_SEED.exists() or INDEX_SEED.read_text(encoding="utf-8") != expected_render["index"]:
            errors.append("index v2 seed is missing or stale; run generate")
        if not ETF_SEED.exists() or ETF_SEED.read_text(encoding="utf-8") != expected_render["etf"]:
            errors.append("ETF v2 seed is missing or stale; run generate")
    if errors:
        raise ValueError("Universe validation failed:\n- " + "\n- ".join(errors[:100]))
    return {
        "universe_version": UNIVERSE_VERSION,
        "index_rows": len(index_rows),
        "index_enabled": sum(_bool(row["radar_enabled"]) for row in index_rows),
        "index_other": sum(row["category"] == "other" for row in index_rows),
        "etf_rows": len(etf_rows),
        "etf_enabled": sum(_bool(row["radar_enabled"]) for row in etf_rows),
        "etf_other": sum(row["category"] == "other" for row in etf_rows),
        "etf_equity": sum(row["radar_scope"] == "EQUITY_ETF" for row in etf_rows),
        "etf_cross_asset": sum(row["radar_scope"] == "CROSS_ASSET" for row in etf_rows),
    }


def _overlay_catalog(catalog: list[dict], rows: list[dict], kind: str) -> list[dict]:
    reviewed = {_symbol_key(row): row for row in rows}
    live_keys = {_symbol_key(row) for row in catalog}
    if live_keys != set(reviewed):
        missing = sorted(live_keys - set(reviewed))[:5]
        stale = sorted(set(reviewed) - live_keys)[:5]
        raise RuntimeError(f"{kind} manifest/catalog drift; missing={missing}, stale={stale}")
    output = []
    for item in catalog:
        row = reviewed[_symbol_key(item)]
        values = {
            **item, "name": row["name"], "category": row["category"],
            "theme_group": row["theme_group"], "theme_label": row["theme_label"],
            "radar_enabled": _bool(row["radar_enabled"]), "universe_version": UNIVERSE_VERSION,
        }
        if kind == "etf":
            values["radar_scope"] = row["radar_scope"] or None
        output.append(values)
    return output


def _exact_count(db, table: str, params: dict | None = None) -> int:
    headers = {**db.headers, "Prefer": "count=exact", "Range": "0-0"}
    response = db._request("GET", table, headers=headers, params={"select": "*", **(params or {})})
    value = response.headers.get("Content-Range", "").rsplit("/", 1)[-1]
    if not value.isdigit():
        raise RuntimeError(f"Could not read exact row count for {table}")
    return int(value)


def _leader_keys(snapshot: dict) -> list[str]:
    return [f"{row.get('market')}:{row.get('code')}" for row in snapshot.get("leaders", [])]


def _snapshot_diff(existing: list[dict], rebuilt: list[dict]) -> dict:
    old_by_date = {str(row.get("trade_date")): row for row in existing}
    new_by_date = {str(row.get("trade_date")): row for row in rebuilt}
    common = sorted(set(old_by_date) & set(new_by_date))
    changed = [value for value in common if _leader_keys(old_by_date[value]) != _leader_keys(new_by_date[value])]
    return {
        "existing_days": len(old_by_date), "rebuilt_days": len(new_by_date),
        "common_days": len(common), "changed_leader_days": len(changed),
        "new_only_days": len(set(new_by_date) - set(old_by_date)),
        "old_only_days": len(set(old_by_date) - set(new_by_date)),
    }


def _classification_changes(live: list[dict], reviewed_rows: list[dict], kind: str) -> dict:
    live_by_key = {_symbol_key(row): row for row in live}
    fields = ["category", "theme_group", "radar_enabled"]
    if kind == "etf":
        fields.append("radar_scope")
    changed_by_field = {}
    changed_keys: set[str] = set()
    for field in fields:
        count = 0
        for row in reviewed_rows:
            current = live_by_key[_symbol_key(row)].get(field)
            expected = _bool(row[field]) if field == "radar_enabled" else (row[field] or None)
            if current != expected:
                count += 1
                changed_keys.add(_symbol_key(row))
        changed_by_field[field] = count
    return {"changed_records": len(changed_keys), "changed_by_field": changed_by_field}


def _gate_failures(scored: list[dict]) -> dict:
    return {
        "scored": len(scored),
        "qualified": sum(bool(row.get("qualifies")) for row in scored),
        # These counts intentionally overlap; one candidate may fail more than
        # one hard gate and the report labels them as such.
        "overlapping_failures": {
            "score_below_60": sum(float(row.get("score", 0)) < 60 for row in scored),
            "not_above_ma60": sum(
                not (row.get("metrics", {}).get("close", 0) > row.get("metrics", {}).get("ma60", 0))
                for row in scored
            ),
            "rs5_and_rs20_nonpositive": sum(
                not (
                    row.get("metrics", {}).get("rs5", 0) > 0
                    or row.get("metrics", {}).get("rs20", 0) > 0
                )
                for row in scored
            ),
            "ma60_breakdown": sum(bool(row.get("breakdown")) for row in scored),
        },
    }


def dry_run() -> dict:
    validation = validate_all()
    _load_env()
    sys.path.insert(0, str(SCRIPT_DIR))
    from sync_baostock import SupabaseRest
    from index_radar import (
        BENCHMARK_CODE, BENCHMARK_MARKET, build_historical_snapshots,
        calculate_candidate, prepare_histories, score_candidates, symbol_key,
    )
    from etf_radar import (
        build_etf_historical_snapshots, prepare_etf_histories,
        select_liquid_theme_representatives,
    )

    db = SupabaseRest()
    index_manifest = load_manifest(INDEX_MANIFEST)
    etf_manifest = load_manifest(ETF_MANIFEST)
    live_index_catalog = db.get_index_catalog()
    live_etf_catalog = db.get_etf_catalog()
    index_catalog = _overlay_catalog(live_index_catalog, index_manifest, "index")
    etf_catalog = _overlay_catalog(live_etf_catalog, etf_manifest, "etf")
    existing_index_snapshots = db.get_radar_snapshots(limit=400)
    existing_etf_snapshots = {
        scope: db.get_etf_radar_snapshots(scope, limit=200)
        for scope in ("EQUITY_ETF", "CROSS_ASSET")
    }

    index_history = db.load_index_history(index_catalog, "1900-01-01")
    benchmark_dates = sorted({
        str(row.get("trade_date")) for row in index_history
        if row.get("market") == "SH" and row.get("code") == "000300"
    })[-400:]
    index_snapshots = build_historical_snapshots(index_catalog, index_history, benchmark_dates)
    if not index_snapshots or index_snapshots[-1]["trade_date"] != benchmark_dates[-1]:
        raise RuntimeError("Index v2 Dry Run did not produce the latest official snapshot")

    latest_date = benchmark_dates[-1]
    index_histories = prepare_histories(index_history)
    index_benchmark = index_histories[symbol_key(BENCHMARK_MARKET, BENCHMARK_CODE)]
    index_candidates = []
    for row in index_catalog:
        if not row.get("active", True) or not row.get("radar_enabled"):
            continue
        series = index_histories.get(symbol_key(row["market"], row["code"]))
        if series:
            candidate = calculate_candidate(series, index_benchmark, latest_date, row)
            if candidate:
                index_candidates.append(candidate)
    index_gate_report = _gate_failures(score_candidates(index_candidates))

    etf_history = db.load_etf_history(etf_catalog, benchmark_dates[-144])
    etf_symbols = {symbol_key(row["market"], row["code"]) for row in etf_catalog}
    etf_histories = prepare_etf_histories(etf_history, etf_symbols)
    etf_report = {}
    for scope in ("EQUITY_ETF", "CROSS_ASSET"):
        snapshots = build_etf_historical_snapshots(
            etf_catalog, etf_history, benchmark_dates[-144:], scope, prior_snapshots=[]
        )
        if not snapshots or snapshots[-1]["trade_date"] != benchmark_dates[-1]:
            raise RuntimeError(f"{scope} v2 Dry Run did not produce the latest official snapshot")
        latest = snapshots[-1]
        representatives, latest_coverage, theme_count = select_liquid_theme_representatives(
            etf_catalog, etf_histories, latest_date, scope
        )
        candidates = []
        for row, _average_amount in representatives:
            candidate = calculate_candidate(
                etf_histories[symbol_key(row["market"], row["code"])],
                etf_histories[symbol_key(BENCHMARK_MARKET, BENCHMARK_CODE)],
                latest_date, row,
            )
            if candidate:
                candidates.append(candidate)
        scored = score_candidates(candidates)
        gate_report = _gate_failures(scored)
        qualified_categories = {}
        for row in scored:
            if row.get("qualifies"):
                category = str(row.get("category", "other"))
                qualified_categories[category] = qualified_categories.get(category, 0) + 1
        gate_report.update({
            "theme_groups_at_latest": theme_count,
            "liquid_representatives": len(representatives),
            "representative_coverage": round(latest_coverage, 6),
            "qualified_categories": qualified_categories,
            "cross_asset_category_cap_excess": (
                sum(max(0, count - 2) for count in qualified_categories.values())
                if scope == "CROSS_ASSET" else 0
            ),
        })
        etf_report[scope] = {
            "snapshot_days": len(snapshots), "latest_date": latest["trade_date"],
            "coverage": latest["coverage"], "universe_count": latest["universe_count"],
            "eligible_count": latest["eligible_count"], "leader_count": len(latest["leaders"]),
            "leaders": [f"{row['market']}:{row['code']} {row['name']}" for row in latest["leaders"]],
            "gate_report": gate_report,
            "snapshot_diff": _snapshot_diff(existing_etf_snapshots[scope], snapshots),
            "previous_latest": {
                "date": existing_etf_snapshots[scope][-1]["trade_date"] if existing_etf_snapshots[scope] else None,
                "universe_version": existing_etf_snapshots[scope][-1].get("universe_version") if existing_etf_snapshots[scope] else None,
                "leader_count": len(existing_etf_snapshots[scope][-1].get("leaders", [])) if existing_etf_snapshots[scope] else 0,
                "leaders": _leader_keys(existing_etf_snapshots[scope][-1]) if existing_etf_snapshots[scope] else [],
            },
        }

    total_rows = _exact_count(db, "market_daily_bar")
    etf_rows = _exact_count(db, "market_daily_bar", {"amount": "not.is.null"})
    capacity = {
        "market_daily_bar_rows": total_rows,
        "etf_market_rows": etf_rows,
        "etf_catalog_rows": _exact_count(db, "market_etf_catalog"),
        "etf_snapshot_rows": _exact_count(db, "market_etf_radar_snapshot"),
        "estimated_etf_storage_mb": {
            "low": round(etf_rows * 170 / 1_000_000, 1),
            "high": round(etf_rows * 280 / 1_000_000, 1),
            "planning_ceiling": 65,
        },
        "universe_v2_estimated_net_growth_mb": "<2",
        "market_row_delta_required": 0,
        "dashboard_warning_headroom_mb": 75,
    }
    latest_index = index_snapshots[-1]
    return {
        "read_only": True, "validation": validation,
        "classification_changes": {
            "index": _classification_changes(live_index_catalog, index_manifest, "index"),
            "etf": _classification_changes(live_etf_catalog, etf_manifest, "etf"),
            "index_theme_groups": len({row["theme_group"] for row in index_manifest if row["radar_enabled"] == "true"}),
            "etf_theme_groups": {
                scope: len({row["theme_group"] for row in etf_manifest if row["radar_scope"] == scope})
                for scope in ("EQUITY_ETF", "CROSS_ASSET")
            },
            "etf_deferred_partial_history": sum(
                row["exclusion_reason"] == "partial_144_session_history_at_review" for row in etf_manifest
            ),
        },
        "index": {
            "snapshot_days": len(index_snapshots), "latest_date": latest_index["trade_date"],
            "coverage": latest_index["coverage"], "universe_count": latest_index["universe_count"],
            "eligible_count": latest_index["eligible_count"],
            "leader_count": len(latest_index["leaders"]),
            "leaders": [f"{row['market']}:{row['code']} {row['name']}" for row in latest_index["leaders"]],
            "gate_report": index_gate_report,
            "snapshot_diff": _snapshot_diff(existing_index_snapshots, index_snapshots),
            "previous_latest": {
                "date": existing_index_snapshots[-1]["trade_date"] if existing_index_snapshots else None,
                "universe_version": existing_index_snapshots[-1].get("universe_version") if existing_index_snapshots else None,
                "leader_count": len(existing_index_snapshots[-1].get("leaders", [])) if existing_index_snapshots else 0,
                "leaders": _leader_keys(existing_index_snapshots[-1]) if existing_index_snapshots else [],
            },
        },
        "etf": etf_report, "capacity": capacity,
    }


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description="Review and audit Market Radar Universe v2")
    parser.add_argument("command", choices=("bootstrap", "generate", "validate", "dry-run"))
    parser.add_argument("--force", action="store_true", help="Required to overwrite review manifests")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.command == "bootstrap":
        bootstrap_manifests(args.force)
    elif args.command == "generate":
        generate_seeds(write=True)
        print(json.dumps(validate_all(), ensure_ascii=False, indent=2))
    elif args.command == "validate":
        print(json.dumps(validate_all(), ensure_ascii=False, indent=2))
    else:
        print(json.dumps(dry_run(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
