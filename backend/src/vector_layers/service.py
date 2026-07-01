from sqlalchemy import select
from sqlalchemy.orm import Session

from src.vector_layers.models import VectorLayer
from src.vector_layers.schemas import VectorLayerCreate, VectorLayerUpdate


def list_vector_layers(db: Session, campaign_id: int) -> list[VectorLayer]:
    return list(
        db.execute(
            select(VectorLayer)
            .where(VectorLayer.campaign_id == campaign_id)
            .order_by(VectorLayer.display_order, VectorLayer.id)
        ).scalars()
    )


def create_vector_layer(db: Session, campaign_id: int, payload: VectorLayerCreate) -> VectorLayer:
    layer = VectorLayer(
        campaign_id=campaign_id,
        name=payload.name,
        pmtiles_url=payload.pmtiles_url,
        source_layer=payload.source_layer,
        color=payload.color,
    )
    db.add(layer)
    db.commit()
    db.refresh(layer)
    return layer


def _get(db: Session, campaign_id: int, layer_id: int) -> VectorLayer | None:
    return db.execute(
        select(VectorLayer).where(
            VectorLayer.id == layer_id, VectorLayer.campaign_id == campaign_id
        )
    ).scalar_one_or_none()


def update_vector_layer(
    db: Session, campaign_id: int, layer_id: int, payload: VectorLayerUpdate
) -> VectorLayer | None:
    layer = _get(db, campaign_id, layer_id)
    if layer is None:
        return None
    data = payload.model_dump(exclude_unset=True)
    for field in ("name", "pmtiles_url", "source_layer", "color", "display_order"):
        if field in data:
            setattr(layer, field, data[field])
    db.commit()
    db.refresh(layer)
    return layer


def delete_vector_layer(db: Session, campaign_id: int, layer_id: int) -> bool:
    layer = _get(db, campaign_id, layer_id)
    if layer is None:
        return False
    db.delete(layer)
    db.commit()
    return True
