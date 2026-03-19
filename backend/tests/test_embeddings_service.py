"""Tests for embeddings service logic (annotation/embeddings_service.py)."""

from unittest.mock import MagicMock, patch

from src.annotation.embeddings_service import (
    knn_label_agrees,
    validate_label_submission,
)


class TestKnnLabelAgrees:
    def test_no_neighbours_agrees(self):
        assert knn_label_agrees([], label_id=1) is True

    def test_majority_matches(self):
        nearest = [
            (MagicMock(), 1, 0.1),
            (MagicMock(), 1, 0.2),
            (MagicMock(), 2, 0.3),
        ]
        assert knn_label_agrees(nearest, label_id=1) is True

    def test_majority_disagrees(self):
        nearest = [
            (MagicMock(), 2, 0.1),
            (MagicMock(), 2, 0.2),
            (MagicMock(), 1, 0.3),
        ]
        assert knn_label_agrees(nearest, label_id=1) is False

    def test_unanimous_agreement(self):
        nearest = [(MagicMock(), 3, d) for d in [0.1, 0.2, 0.3, 0.4, 0.5]]
        assert knn_label_agrees(nearest, label_id=3) is True

    def test_unanimous_disagreement(self):
        nearest = [(MagicMock(), 3, d) for d in [0.1, 0.2, 0.3, 0.4, 0.5]]
        assert knn_label_agrees(nearest, label_id=99) is False

    def test_tie_resolved_by_first_max(self):
        nearest = [
            (MagicMock(), 1, 0.1),
            (MagicMock(), 2, 0.2),
        ]
        result = knn_label_agrees(nearest, label_id=1)
        assert isinstance(result, bool)


class TestValidateLabelSubmission:
    @patch("src.annotation.embeddings_service.get_embedding_by_task")
    def test_no_embedding_returns_skipped(self, mock_get_emb):
        mock_get_emb.return_value = None
        db = MagicMock()

        result = validate_label_submission(db, campaign_id=1, annotation_task_id=1, label_id=1)
        assert result.status == "skipped_no_embedding"
        assert result.agrees is None

    @patch("src.annotation.embeddings_service.has_sufficient_validation_data")
    @patch("src.annotation.embeddings_service.get_embedding_by_task")
    def test_insufficient_data_returns_skipped(self, mock_get_emb, mock_sufficient):
        mock_get_emb.return_value = MagicMock(vector=[0.0] * 64)
        mock_sufficient.return_value = False
        db = MagicMock()

        result = validate_label_submission(db, campaign_id=1, annotation_task_id=1, label_id=1)
        assert result.status == "skipped_insufficient_data"
        assert result.agrees is None

    @patch("src.annotation.embeddings_service.find_nearest_labeled_embeddings")
    @patch("src.annotation.embeddings_service.has_sufficient_validation_data")
    @patch("src.annotation.embeddings_service.get_embedding_by_task")
    def test_label_agrees_returns_ok(self, mock_get_emb, mock_sufficient, mock_find_nearest):
        mock_get_emb.return_value = MagicMock(vector=[0.0] * 64)
        mock_sufficient.return_value = True
        mock_find_nearest.return_value = [
            (MagicMock(), 1, 0.1),
            (MagicMock(), 1, 0.2),
            (MagicMock(), 1, 0.3),
        ]
        db = MagicMock()

        result = validate_label_submission(db, campaign_id=1, annotation_task_id=1, label_id=1)
        assert result.status == "ok"
        assert result.agrees is True

    @patch("src.annotation.embeddings_service.find_nearest_labeled_embeddings")
    @patch("src.annotation.embeddings_service.has_sufficient_validation_data")
    @patch("src.annotation.embeddings_service.get_embedding_by_task")
    def test_label_disagrees_returns_mismatch(
        self, mock_get_emb, mock_sufficient, mock_find_nearest
    ):
        mock_get_emb.return_value = MagicMock(vector=[0.0] * 64)
        mock_sufficient.return_value = True
        mock_find_nearest.return_value = [
            (MagicMock(), 2, 0.1),
            (MagicMock(), 2, 0.2),
            (MagicMock(), 2, 0.3),
        ]
        db = MagicMock()

        result = validate_label_submission(db, campaign_id=1, annotation_task_id=1, label_id=1)
        assert result.status == "mismatch"
        assert result.agrees is False
