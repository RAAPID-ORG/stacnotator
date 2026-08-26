from src.routing import attachment_headers, snake_to_camel


class TestSnakeToCamel:
    def test_basic(self):
        assert snake_to_camel("get_campaign_list") == "getCampaignList"

    def test_single_word(self):
        assert snake_to_camel("health") == "health"

    def test_two_words(self):
        assert snake_to_camel("create_campaign") == "createCampaign"

    def test_many_underscores(self):
        assert snake_to_camel("get_all_user_annotations") == "getAllUserAnnotations"


def filename_of(headers: dict[str, str]) -> str:
    return headers["Content-Disposition"].split('filename="')[1].rstrip('"')


class TestAttachmentHeaders:
    def test_keeps_a_plain_name_readable(self):
        assert filename_of(attachment_headers("campaign_kyiv_annotations", "csv")) == (
            "campaign_kyiv_annotations.csv"
        )

    def test_folds_case_and_spaces(self):
        assert filename_of(attachment_headers("campaign_My Field 2024", "csv")) == (
            "campaign_my_field_2024.csv"
        )

    def test_strips_what_would_break_the_header(self):
        # A campaign named with a quote would otherwise close the header's own
        # quoting and let the rest of the name be read as parameters.
        name = 'campaign_a"; filename="evil.sh'
        assert filename_of(attachment_headers(name, "csv")) == "campaign_a_filename_evil_sh.csv"

    def test_transliterates_unicode(self):
        assert filename_of(attachment_headers("campaign_café résumé", "geojson")) == (
            "campaign_cafe_resume.geojson"
        )

    def test_truncates_a_very_long_name_but_keeps_the_extension(self):
        headers = attachment_headers("campaign_" + "a" * 500, "zip")
        stem, _, extension = filename_of(headers).rpartition(".")
        assert len(stem) == 100
        assert extension == "zip"

    def test_collapses_an_empty_campaign_name(self):
        assert filename_of(attachment_headers("campaign__annotations", "csv")) == (
            "campaign_annotations.csv"
        )
