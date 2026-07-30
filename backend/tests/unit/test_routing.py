from src.routing import snake_to_camel


class TestSnakeToCamel:
    def test_basic(self):
        assert snake_to_camel("get_campaign_list") == "getCampaignList"

    def test_single_word(self):
        assert snake_to_camel("health") == "health"

    def test_two_words(self):
        assert snake_to_camel("create_campaign") == "createCampaign"

    def test_many_underscores(self):
        assert snake_to_camel("get_all_user_annotations") == "getAllUserAnnotations"
