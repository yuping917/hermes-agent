"""Config v50: the compatibility bundle retains the operator tirith policy."""

import hermes_yaml as yaml


class TestRetainedTirithKeys:
    def _seed(self, tmp_path):
        config_path = tmp_path / "config.yaml"
        config_path.write_text(yaml.safe_dump({
            "_config_version": 49,
            "security": {
                "redact_secrets": True,
                "tirith_enabled": True,
                "tirith_path": "/opt/custom/tirith",
                "tirith_timeout": 9,
                "tirith_fail_open": False,
            },
            "plugins": {"enabled": ["mem0"]},
        }), encoding="utf-8")
        return config_path

    def test_v50_step_preserves_all_tirith_keys(self, tmp_path, monkeypatch):
        """The compatibility bundle keeps the scanner, so the v50 step is a pure no-op: it must
        preserve ALL FOUR operator tirith keys verbatim, keep sibling security settings and an
        existing plugin selection, and enable no replacement plugin (upstream asserted the
        opposite — that v50 drops the keys and enables nothing)."""
        from hermes_cli.config import DEFAULT_CONFIG
        from hermes_cli.config_migrations import run_migrations

        config_path = self._seed(tmp_path)
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        run_migrations(49, {"env_added": [], "config_added": [], "warnings": []}, quiet=True)
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        assert raw["security"] == {
            "redact_secrets": True, "tirith_enabled": True, "tirith_path": "/opt/custom/tirith",
            "tirith_timeout": 9, "tirith_fail_open": False,
        }
        assert raw["plugins"]["enabled"] == ["mem0"]
        for key in ("tirith_enabled", "tirith_path", "tirith_timeout", "tirith_fail_open"):
            assert key in DEFAULT_CONFIG["security"]

    def test_migrate_config_still_stamps_latest_schema(self, tmp_path, monkeypatch):
        """End-to-end startup path: the dispatcher (not the no-op step) advances the stamp, so a
        v49 config still reaches the latest schema with the scanner policy intact, and a second
        pass writes nothing and stays byte-identical. This is the strong check that a no-op step
        does not strand the schema below latest."""
        from hermes_cli.config import DEFAULT_CONFIG, migrate_config

        config_path = self._seed(tmp_path)
        monkeypatch.setenv("HERMES_HOME", str(tmp_path))
        migrate_config(interactive=False, quiet=True)
        raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
        assert raw["_config_version"] == DEFAULT_CONFIG["_config_version"]
        assert raw["security"]["tirith_enabled"] is True
        assert raw["security"]["tirith_fail_open"] is False
        settled = config_path.read_bytes()
        assert migrate_config(interactive=False, quiet=True)["config_added"] == []
        assert config_path.read_bytes() == settled
