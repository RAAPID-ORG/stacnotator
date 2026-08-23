from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src.auth.dependencies import optional_user, require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.organizations.service import is_active_org_member
from src.projects.access import has_project_access
from src.projects.dependencies import require_project_access, require_project_admin
from src.projects.models import Project, ProjectUser
from src.tilers.tokens import TILER_TOKEN_TTL, set_tiler_cookie
from src.visualizers import service
from src.visualizers.models import Visualizer
from src.visualizers.schemas import (
    TilerSessionOut,
    VisualizerConfigOut,
    VisualizerCreate,
    VisualizerListItemOut,
    VisualizerOptionsOut,
    VisualizerUpdate,
    VisualizerViewOut,
)

bearer = HTTPBearer()

project_router = APIRouter(
    prefix="/projects/{project_id}/visualizers",
    tags=["Visualizers"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


@project_router.get("", response_model=list[VisualizerListItemOut])
def list_visualizers(
    project_id: int,
    project: Project = Depends(require_project_access),
    db: Session = Depends(get_db),
):
    return service.list_for_project(db, project_id)


@project_router.get("/options", response_model=VisualizerOptionsOut)
def list_visualizer_options(
    project_id: int,
    project: Project = Depends(require_project_admin),
    db: Session = Depends(get_db),
):
    """The project's registered imagery and overlays, as a visualizer can use them."""
    return service.options(db, project_id)


@project_router.post("", response_model=VisualizerConfigOut, status_code=201)
def create_visualizer(
    project_id: int,
    payload: VisualizerCreate,
    project: Project = Depends(require_project_admin),
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
):
    return service.config_out(service.create(db, project, payload, user.id))


visualizer_router = APIRouter(
    prefix="/visualizers/{visualizer_id}",
    tags=["Visualizers"],
    dependencies=[Depends(bearer), Depends(require_authenticated_user)],
)


def _require_admin(
    visualizer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(require_authenticated_user),
) -> Visualizer:
    visualizer = service.load(db, visualizer_id=visualizer_id)
    require_project_admin(project_id=visualizer.project_id, db=db, user=user)
    return visualizer


@visualizer_router.get("", response_model=VisualizerConfigOut)
def get_visualizer(visualizer: Visualizer = Depends(_require_admin)):
    return service.config_out(visualizer)


@visualizer_router.patch("", response_model=VisualizerConfigOut)
def update_visualizer(
    payload: VisualizerUpdate,
    visualizer: Visualizer = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    return service.config_out(service.update(db, visualizer, payload))


@visualizer_router.delete("", status_code=204)
def delete_visualizer(
    visualizer: Visualizer = Depends(_require_admin),
    db: Session = Depends(get_db),
):
    service.delete(db, visualizer)
    return Response(status_code=204)


# The viewer page is reachable without an account when the visualizer is public,
# so this router carries no bearer dependency - the same arrangement the tile
# proxy uses. `optional_user` still identifies members, which is what lets an
# unpublished visualizer be previewed by the people who own it.
shared_router = APIRouter(prefix="/shared-visualizers/{slug}", tags=["Visualizers"])


def _require_viewer(
    slug: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> tuple[Visualizer, bool]:
    """The visualizer and whether this viewer may edit it.

    A published visualizer is readable by anyone; an unpublished one falls back
    to the project's own access rule, so it is a working preview for the team
    before the link goes out.
    """
    visualizer = service.load(db, slug=slug)
    if user is None:
        if not visualizer.is_public:
            raise HTTPException(status_code=404, detail="Visualizer not found")
        return visualizer, False

    project = visualizer.project
    membership = (
        db.query(ProjectUser)
        .filter(ProjectUser.project_id == project.id, ProjectUser.user_id == user.id)
        .one_or_none()
    )
    can_edit = (membership is not None and membership.is_admin) or user.is_admin
    if visualizer.is_public or can_edit:
        return visualizer, can_edit
    if has_project_access(
        visibility=project.visibility,
        is_active_org_member=is_active_org_member(db, user.id, project.organization_id),
        is_member=membership is not None,
        is_platform_admin=user.is_admin,
    ):
        return visualizer, False
    raise HTTPException(status_code=404, detail="Visualizer not found")


@shared_router.get("", response_model=VisualizerViewOut)
def get_shared_visualizer(
    viewer: tuple[Visualizer, bool] = Depends(_require_viewer),
    db: Session = Depends(get_db),
):
    visualizer, can_edit = viewer
    return service.build_view(db, visualizer, can_edit=can_edit)


@shared_router.post("/tiler-token", response_model=TilerSessionOut)
def get_visualizer_tiler_token(
    response: Response,
    viewer: tuple[Visualizer, bool] = Depends(_require_viewer),
):
    """Tile access for exactly the campaigns this visualizer draws from.

    Scoping the token to the visualizer's own campaigns is what lets a visitor
    with no account fetch its tiles without opening anything else.
    """
    visualizer, _ = viewer
    set_tiler_cookie(
        response,
        sub=f"visualizer:{visualizer.id}",
        campaigns=service.referenced_campaign_ids(visualizer),
    )
    return TilerSessionOut(expires_in=TILER_TOKEN_TTL)


router = APIRouter()
router.include_router(project_router)
router.include_router(visualizer_router)
router.include_router(shared_router)
