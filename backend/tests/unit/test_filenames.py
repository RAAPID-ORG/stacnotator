from src.filenames import clean_filename


class TestCleanFilename:
    def test_basic(self):
        assert clean_filename("Hello World") == "hello_world"

    def test_special_characters(self):
        assert clean_filename("file@name#1!") == "file_name_1"

    def test_unicode(self):
        assert clean_filename("café résumé") == "cafe_resume"

    def test_truncation(self):
        result = clean_filename("a" * 100, max_length=10)
        assert len(result) == 10

    def test_empty_string(self):
        assert clean_filename("") == ""

    def test_none_passthrough(self):
        assert clean_filename(None) is None

    def test_leading_trailing_underscores_stripped(self):
        assert clean_filename("  hello  ") == "hello"
