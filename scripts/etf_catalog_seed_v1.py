"""Reviewed BaoStock ETF Radar classification seed v1.

The key is permanent ``MARKET:CODE``.  Each value is:
``(reviewed_name, category, radar_scope, theme_group, theme_label, enabled)``.

Runtime classification is deliberately code-only.  A newly listed ETF is
stored as raw market data but remains ``other`` / Radar-disabled until a
reviewed seed revision adds it.  The name is documentation; the current
official security name supplied by BaoStock is persisted in the catalog.
"""

ETF_CATALOG_SEED_V1 = {
    # Domestic broad-market equity
    "SH:510050": ("SSE 50 ETF", "equity_broad", "EQUITY_ETF", "sse50", "SSE 50", True),
    "SH:510300": ("CSI 300 ETF", "equity_broad", "EQUITY_ETF", "csi300", "CSI 300", True),
    "SH:510310": ("CSI 300 ETF", "equity_broad", "EQUITY_ETF", "csi300", "CSI 300", True),
    "SH:510330": ("CSI 300 ETF", "equity_broad", "EQUITY_ETF", "csi300", "CSI 300", True),
    "SZ:159919": ("CSI 300 ETF", "equity_broad", "EQUITY_ETF", "csi300", "CSI 300", True),
    "SH:510500": ("CSI 500 ETF", "equity_broad", "EQUITY_ETF", "csi500", "CSI 500", True),
    "SH:510510": ("CSI 500 ETF", "equity_broad", "EQUITY_ETF", "csi500", "CSI 500", True),
    "SH:510580": ("CSI 500 ETF", "equity_broad", "EQUITY_ETF", "csi500", "CSI 500", True),
    "SZ:159922": ("CSI 500 ETF", "equity_broad", "EQUITY_ETF", "csi500", "CSI 500", True),
    "SH:512100": ("CSI 1000 ETF", "equity_broad", "EQUITY_ETF", "csi1000", "CSI 1000", True),
    "SZ:159845": ("CSI 1000 ETF", "equity_broad", "EQUITY_ETF", "csi1000", "CSI 1000", True),
    "SH:563300": ("CSI 2000 ETF", "equity_broad", "EQUITY_ETF", "csi2000", "CSI 2000", True),
    "SZ:159531": ("CSI 2000 ETF", "equity_broad", "EQUITY_ETF", "csi2000", "CSI 2000", True),
    "SH:588000": ("STAR 50 ETF", "equity_broad", "EQUITY_ETF", "star50", "STAR 50", True),
    "SH:588080": ("STAR 50 ETF", "equity_broad", "EQUITY_ETF", "star50", "STAR 50", True),
    "SH:588090": ("STAR 50 ETF", "equity_broad", "EQUITY_ETF", "star50", "STAR 50", True),
    "SZ:159915": ("ChiNext ETF", "equity_broad", "EQUITY_ETF", "chinext", "ChiNext", True),
    "SZ:159949": ("ChiNext 50 ETF", "equity_broad", "EQUITY_ETF", "chinext50", "ChiNext 50", True),

    # Domestic sector and theme equity
    "SH:512480": ("Semiconductor ETF", "equity_theme", "EQUITY_ETF", "semiconductor", "Semiconductor", True),
    "SH:512760": ("Semiconductor ETF", "equity_theme", "EQUITY_ETF", "semiconductor", "Semiconductor", True),
    "SZ:159995": ("Chip ETF", "equity_theme", "EQUITY_ETF", "semiconductor", "Semiconductor", True),
    "SH:515980": ("AI ETF", "equity_theme", "EQUITY_ETF", "ai_computing", "AI & Computing", True),
    "SH:516510": ("Cloud Computing ETF", "equity_theme", "EQUITY_ETF", "cloud_computing", "Cloud Computing", True),
    "SZ:159852": ("Software ETF", "equity_sector", "EQUITY_ETF", "software", "Software", True),
    "SZ:159869": ("Gaming ETF", "equity_theme", "EQUITY_ETF", "gaming", "Gaming", True),
    "SH:512980": ("Media ETF", "equity_sector", "EQUITY_ETF", "media", "Media", True),
    "SH:512660": ("Defense ETF", "equity_sector", "EQUITY_ETF", "defense", "Defense", True),
    "SH:512670": ("Defense ETF", "equity_sector", "EQUITY_ETF", "defense", "Defense", True),
    "SH:515030": ("New Energy Vehicle ETF", "equity_theme", "EQUITY_ETF", "new_energy_vehicle", "New Energy Vehicle", True),
    "SH:515790": ("Solar ETF", "equity_theme", "EQUITY_ETF", "solar", "Solar", True),
    "SH:516160": ("New Energy ETF", "equity_theme", "EQUITY_ETF", "new_energy", "New Energy", True),
    "SZ:159611": ("Power Utilities ETF", "equity_sector", "EQUITY_ETF", "utilities", "Utilities", True),
    "SH:512170": ("Healthcare ETF", "equity_sector", "EQUITY_ETF", "healthcare", "Healthcare", True),
    "SH:512290": ("Biotechnology ETF", "equity_theme", "EQUITY_ETF", "biotechnology", "Biotechnology", True),
    "SH:516820": ("Medical Innovation ETF", "equity_theme", "EQUITY_ETF", "medical_innovation", "Medical Innovation", True),
    "SZ:159929": ("Healthcare ETF", "equity_sector", "EQUITY_ETF", "healthcare", "Healthcare", True),
    "SH:512690": ("Liquor ETF", "equity_theme", "EQUITY_ETF", "liquor", "Liquor", True),
    "SH:512200": ("Real Estate ETF", "equity_sector", "EQUITY_ETF", "real_estate", "Real Estate", True),
    "SH:512800": ("Bank ETF", "equity_sector", "EQUITY_ETF", "banking", "Banking", True),
    "SH:512000": ("Securities ETF", "equity_sector", "EQUITY_ETF", "securities", "Securities", True),
    "SH:512400": ("Non-ferrous Metals ETF", "equity_sector", "EQUITY_ETF", "metals", "Metals", True),
    "SH:515220": ("Coal ETF", "equity_sector", "EQUITY_ETF", "coal", "Coal", True),
    "SZ:159870": ("Chemical Industry ETF", "equity_sector", "EQUITY_ETF", "chemicals", "Chemicals", True),
    "SH:516970": ("Infrastructure ETF", "equity_theme", "EQUITY_ETF", "infrastructure", "Infrastructure", True),

    # Domestic equity strategies
    "SH:510880": ("Dividend ETF", "equity_strategy", "EQUITY_ETF", "dividend", "Dividend", True),
    "SH:515180": ("Dividend ETF", "equity_strategy", "EQUITY_ETF", "dividend", "Dividend", True),
    "SH:512890": ("Dividend Low Volatility ETF", "equity_strategy", "EQUITY_ETF", "dividend_low_vol", "Dividend Low Vol", True),
    "SH:515450": ("Large-cap Dividend Low Vol ETF", "equity_strategy", "EQUITY_ETF", "dividend_low_vol", "Dividend Low Vol", True),

    # Overseas exchange-traded assets
    "SH:513100": ("NASDAQ 100 ETF", "overseas", "CROSS_ASSET", "nasdaq100", "NASDAQ 100", True),
    "SZ:159941": ("NASDAQ 100 ETF", "overseas", "CROSS_ASSET", "nasdaq100", "NASDAQ 100", True),
    "SH:513500": ("S&P 500 ETF", "overseas", "CROSS_ASSET", "sp500", "S&P 500", True),
    "SH:513030": ("Germany ETF", "overseas", "CROSS_ASSET", "germany_equity", "Germany Equity", True),
    "SH:513080": ("France CAC 40 ETF", "overseas", "CROSS_ASSET", "france_equity", "France Equity", True),
    "SH:513520": ("Nikkei 225 ETF", "overseas", "CROSS_ASSET", "nikkei225", "Nikkei 225", True),
    "SH:513880": ("Nikkei 225 ETF", "overseas", "CROSS_ASSET", "nikkei225", "Nikkei 225", True),
    "SH:513660": ("Hang Seng ETF", "overseas", "CROSS_ASSET", "hang_seng", "Hang Seng", True),
    "SZ:159920": ("Hang Seng ETF", "overseas", "CROSS_ASSET", "hang_seng", "Hang Seng", True),
    "SH:513180": ("Hang Seng Technology ETF", "overseas", "CROSS_ASSET", "hang_seng_tech", "Hang Seng Tech", True),
    "SH:513130": ("Hang Seng Technology ETF", "overseas", "CROSS_ASSET", "hang_seng_tech", "Hang Seng Tech", True),
    "SH:513060": ("Hang Seng Healthcare ETF", "overseas", "CROSS_ASSET", "hang_seng_healthcare", "HK Healthcare", True),
    "SH:513330": ("Hang Seng Internet ETF", "overseas", "CROSS_ASSET", "hang_seng_internet", "HK Internet", True),
    "SZ:159792": ("Hong Kong Internet ETF", "overseas", "CROSS_ASSET", "hang_seng_internet", "HK Internet", True),

    # Commodities
    "SH:518880": ("Gold ETF", "commodity", "CROSS_ASSET", "gold", "Gold", True),
    "SH:518800": ("Gold ETF", "commodity", "CROSS_ASSET", "gold", "Gold", True),
    "SH:518600": ("Gold ETF", "commodity", "CROSS_ASSET", "gold", "Gold", True),
    "SZ:159934": ("Gold ETF", "commodity", "CROSS_ASSET", "gold", "Gold", True),
    "SZ:159937": ("Gold ETF", "commodity", "CROSS_ASSET", "gold", "Gold", True),
    "SZ:159980": ("Non-ferrous Futures ETF", "commodity", "CROSS_ASSET", "nonferrous_futures", "Non-ferrous Futures", True),
    "SZ:159981": ("Energy Chemical Futures ETF", "commodity", "CROSS_ASSET", "energy_chemical_futures", "Energy Chemicals", True),
    "SZ:159985": ("Soybean Meal ETF", "commodity", "CROSS_ASSET", "soybean_meal", "Soybean Meal", True),

    # Bonds and cash-management ETFs
    "SH:511010": ("5Y Treasury Bond ETF", "bond", "CROSS_ASSET", "treasury_5y", "5Y Treasury", True),
    "SH:511020": ("5-10Y Treasury Bond ETF", "bond", "CROSS_ASSET", "treasury_5_10y", "5-10Y Treasury", True),
    "SH:511090": ("30Y Treasury Bond ETF", "bond", "CROSS_ASSET", "treasury_30y", "30Y Treasury", True),
    "SH:511220": ("Urban Investment Bond ETF", "bond", "CROSS_ASSET", "urban_investment_bond", "Urban Investment Bond", True),
    "SH:511260": ("10Y Treasury Bond ETF", "bond", "CROSS_ASSET", "treasury_10y", "10Y Treasury", True),
    "SH:511360": ("Short-term Bond ETF", "bond", "CROSS_ASSET", "short_bond", "Short Bond", True),
    "SH:511660": ("Money Market ETF", "money", "CROSS_ASSET", "money_market", "Money Market", True),
    "SH:511850": ("Money Market ETF", "money", "CROSS_ASSET", "money_market", "Money Market", True),
    "SH:511880": ("Money Market ETF", "money", "CROSS_ASSET", "money_market", "Money Market", True),
    "SH:511990": ("Money Market ETF", "money", "CROSS_ASSET", "money_market", "Money Market", True),
}
