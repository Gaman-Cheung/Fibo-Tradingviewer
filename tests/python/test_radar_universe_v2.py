import unittest

from scripts.etf_catalog_seed_v2 import ETF_CATALOG_SEED_V2
from scripts.index_catalog_seed_v2 import INDEX_CATALOG_SEED_V2
from scripts.etf_radar import UNIVERSE_VERSION as ETF_UNIVERSE_VERSION, classify_etf
from scripts.index_radar import UNIVERSE_VERSION as INDEX_UNIVERSE_VERSION, classify_index
from scripts.radar_universe_v2 import (
    ETF_MANIFEST,
    INDEX_MANIFEST,
    generate_seeds,
    load_manifest,
    validate_manifest,
)


class RadarUniverseV2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.index_rows = load_manifest(INDEX_MANIFEST)
        cls.etf_rows = load_manifest(ETF_MANIFEST)
        cls.index_by_key = {f"{row['market']}:{row['code']}": row for row in cls.index_rows}
        cls.etf_by_key = {f"{row['market']}:{row['code']}": row for row in cls.etf_rows}

    def test_manifests_are_complete_unique_reviewed_and_evidenced(self):
        self.assertEqual(validate_manifest(self.index_rows, "index"), [])
        self.assertEqual(validate_manifest(self.etf_rows, "etf"), [])
        self.assertEqual(len(self.index_rows), 507)
        self.assertEqual(len(self.etf_rows), 1615)
        self.assertEqual(len(self.index_by_key), 507)
        self.assertEqual(len(self.etf_by_key), 1615)
        self.assertTrue(all(row["review_status"] == "reviewed" for row in self.index_rows + self.etf_rows))
        self.assertTrue(all(row["source_url"].startswith("https://") for row in self.index_rows + self.etf_rows))
        self.assertTrue(all(row["exclusion_reason"] for row in self.index_rows + self.etf_rows if row["radar_enabled"] == "false"))

    def test_generated_seeds_are_complete_and_runtime_uses_v2(self):
        rendered = generate_seeds(write=False)
        self.assertIn("INDEX_CATALOG_SEED_V2", rendered["index"])
        self.assertIn("ETF_CATALOG_SEED_V2", rendered["etf"])
        self.assertEqual(len(INDEX_CATALOG_SEED_V2), 507)
        self.assertEqual(len(ETF_CATALOG_SEED_V2), 1615)
        self.assertEqual(INDEX_UNIVERSE_VERSION, 2)
        self.assertEqual(ETF_UNIVERSE_VERSION, 2)

    def test_obvious_legacy_index_others_are_now_explicit(self):
        expected = {
            "SH:000039": ("sector", "information_technology"),
            "SH:000928": ("sector", "energy"),
            "SH:000160": ("theme", "construction"),
            "SZ:399418": ("theme", "data_digital"),
        }
        for key, value in expected.items():
            market, code = key.split(":")
            result = classify_index(market, code, "ignored display name")
            self.assertEqual((result["category"], result["theme_group"]), value)
            self.assertTrue(result["radar_enabled"])
        self.assertEqual(sum(row["category"] == "other" for row in self.index_rows), 0)

    def test_etf_asset_types_and_theme_equivalence_are_reviewed_by_code(self):
        cases = {
            "SH:518600": ("commodity", "CROSS_ASSET", "gold"),
            "SH:511360": ("bond", "CROSS_ASSET", "bond_0_3y"),
            "SZ:159649": ("bond", "CROSS_ASSET", "policy_financial_bond_1_5y"),
            "SZ:159941": ("overseas", "CROSS_ASSET", "nasdaq100"),
            "SH:515450": ("equity_strategy", "EQUITY_ETF", "dividend_low_vol"),
            "SH:512010": ("equity_sector", "EQUITY_ETF", "healthcare"),
        }
        for key, expected in cases.items():
            market, code = key.split(":")
            result = classify_etf(market, code, "name cannot change classification")
            self.assertEqual((result["category"], result["radar_scope"], result["theme_group"]), expected)
        self.assertEqual(classify_etf("SH", "512800")["theme_group"], "banking")
        self.assertEqual(classify_etf("SH", "512700")["theme_group"], "banking")

    def test_partial_history_is_classified_but_deferred_and_unknown_names_are_not_fabricated(self):
        recent = self.etf_by_key["SZ:159086"]
        self.assertEqual((recent["category"], recent["radar_scope"]), ("equity_theme", "EQUITY_ETF"))
        self.assertEqual(recent["radar_enabled"], "false")
        self.assertEqual(recent["exclusion_reason"], "partial_144_session_history_at_review")
        excluded = [row for row in self.etf_rows if row["category"] == "other"]
        self.assertEqual(len(excluded), 4)
        self.assertTrue(all(row["active_at_review"] == "false" for row in excluded))
        self.assertTrue(all(row["exclusion_reason"] == "official_name_unavailable_in_current_catalog" for row in excluded))


if __name__ == "__main__":
    unittest.main()
