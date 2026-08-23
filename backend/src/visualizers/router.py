from dataclasses import dataclass

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.security import HTTPBearer
from sqlalchemy.orm import Session

from src import background
from src.auth.dependencies import optional_user, require_authenticated_user
from src.auth.models import User
from src.database import get_db
from src.imagery import registration
from src.organizations.service import is_active_org_member
from src.projects.access import has_project_access
from src.projects.dependencies import require_project_access, require_project_admin
from src.projects.models import Project, ProjectUser
from src.tilers.tokens import TILER_TOKEN_TTL, set_tiler_cookie
from src.visualizers import service
from src.visualizers.dependencies import require_visualizer_admin
from src.visualizers.models import Visualizer
from src.visualizers.schemas import (
    TilerSessionOut,
    VisualizerConfigOut,
    VisualizerCreate,
    VisualizerFeedbackCreate,
    VisualizerFeedbackOut,
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


@visualizer_router.get("", response_model=VisualizerConfigOut)
def get_visualizer(
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    # The editor polls this while imagery registers; recover here if the run's
    # worker died, so nobody is left watching "registering" forever.
    if visualizer.registration_status == "registering" and background.fail_stale_status_runs(
        db, (registration.VISUALIZER_REGISTRATION_RUN,), row_id=visualizer.id
    ):
        db.commit()
        db.refresh(visualizer)
    return service.config_out(visualizer)


@visualizer_router.patch("", response_model=VisualizerConfigOut)
def update_visualizer(
    payload: VisualizerUpdate,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    return service.config_out(service.update(db, visualizer, payload))


@visualizer_router.get("/feedback", response_model=list[VisualizerFeedbackOut])
def list_visualizer_feedback(
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    return service.list_feedback(db, visualizer.id)


@visualizer_router.delete("/feedback/{feedback_id}", status_code=204)
def delete_visualizer_feedback(
    feedback_id: int,
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    if not service.delete_feedback(db, visualizer.id, feedback_id):
        raise HTTPException(status_code=404, detail="Feedback not found")
    return Response(status_code=204)


@visualizer_router.delete("", status_code=204)
def delete_visualizer(
    visualizer: Visualizer = Depends(require_visualizer_admin),
    db: Session = Depends(get_db),
):
    service.delete(db, visualizer)
    return Response(status_code=204)


# The viewer page is reachable without an account when the visualizer is public,
# so this router carries no bearer dependency - the same arrangement the tile
# proxy uses. `optional_user` still identifies members, which is what lets an
# unpublished visualizer be previewed by the people who own it.
shared_router = APIRouter(prefix="/shared-visualizers/{slug}", tags=["Visualizers"])


@dataclass(frozen=True)
class Viewer:
    """A visualizer and what the person looking at it may do with it."""

    visualizer: Visualizer
    user: User | None
    can_edit: bool

    @property
    def can_give_feedback(self) -> bool:
        """Feedback is a platform contribution, so it takes an account - even
        though reading a published map does not."""
        return self.user is not None


def _require_viewer(
    slug: str,
    db: Session = Depends(get_db),
    user: User | None = Depends(optional_user),
) -> Viewer:
    """The visualizer and whether this viewer may edit it.

    A published visualizer is readable by anyone; an unpublished one falls back
    to the project's own access rule, so it is a working preview for the team
    before the link goes out.
    """
    visualizer = service.load(db, slug=slug)
    if user is None:
        if not visualizer.is_public:
            raise HTTPException(status_code=404, detail="Visualizer not found")
        return Viewer(visualizer=visualizer, user=None, can_edit=False)

    project = visualizer.project
    membership = (
        db.query(ProjectUser)
        .filter(ProjectUser.project_id == project.id, ProjectUser.user_id == user.id)
        .one_or_none()
    )
    can_edit = (membership is not None and membership.is_admin) or user.is_admin
    if visualizer.is_public or can_edit:
        return Viewer(visualizer=visualizer, user=user, can_edit=can_edit)
    if has_project_access(
        visibility=project.visibility,
        is_active_org_member=is_active_org_member(db, user.id, project.organization_id),
        is_member=membership is not None,
        is_platform_admin=user.is_admin,
    ):
        return Viewer(visualizer=visualizer, user=user, can_edit=False)
    raise HTTPException(status_code=404, detail="Visualizer not found")


@shared_router.get("", response_model=VisualizerViewOut)
def get_shared_visualizer(
    viewer: Viewer = Depends(_require_viewer),
    db: Session = Depends(get_db),
):
    return service.build_view(
        db,
        viewer.visualizer,
        can_edit=viewer.can_edit,
        can_give_feedback=viewer.can_give_feedback,
    )


@shared_router.post("/feedback", response_model=VisualizerFeedbackOut, status_code=201)
def add_visualizer_feedback(
    payload: VisualizerFeedbackCreate,
    viewer: Viewer = Depends(_require_viewer),
    db: Session = Depends(get_db),
):
    """Leave a remark about one place on this map. Takes an account."""
    if viewer.user is None:
        raise HTTPException(status_code=401, detail="Sign in to leave feedback")
    feedback = service.add_feedback(db, viewer.visualizer, payload, viewer.user)
    return service.list_feedback(db, viewer.visualizer.id)[0] if feedback else None


@shared_router.post("/tiler-token", response_model=TilerSessionOut)
def get_visualizer_tiler_token(
    response: Response,
    viewer: Viewer = Depends(_require_viewer),
):
    """Tile access for exactly the campaigns this visualizer draws from.

    Scoping the token to the visualizer's own campaigns is what lets a visitor
    with no account fetch its tiles without opening anything else.
    """
    set_tiler_cookie(
        response,
        sub=f"visualizer:{viewer.visualizer.id}",
        campaigns=service.tile_scopes(viewer.visualizer),
    )
    return TilerSessionOut(expires_in=TILER_TOKEN_TTL)


router = APIRouter()
router.include_router(project_router)
router.include_router(visualizer_router)
router.include_router(shared_router)
