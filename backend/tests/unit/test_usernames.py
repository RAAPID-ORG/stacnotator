from src.auth.usernames import MAX_LENGTH, username_error


class TestUsernameError:
    def test_accepts_the_common_shapes(self):
        for name in ("ada", "ada.lovelace", "ada_lovelace", "ada-1", "A1"[:2] + "b"):
            assert username_error(name) is None

    def test_rejects_too_short_and_too_long(self):
        assert "at least" in (username_error("ab") or "")
        assert "at most" in (username_error("a" * (MAX_LENGTH + 1)) or "")

    def test_rejects_spaces_and_other_punctuation(self):
        for name in ("ada lovelace", "ada@home", "ada/lovelace", "ada!"):
            assert username_error(name) is not None

    def test_rejects_a_leading_separator(self):
        for name in (".ada", "_ada", "-ada"):
            assert username_error(name) is not None
