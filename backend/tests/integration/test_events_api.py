from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.event import Event, EventStatus
from app.models.user import User, UserRole
from app.providers.face.fake import FakeFaceProvider

MakeUser = Callable[..., User]
MakeEvent = Callable[..., Event]
Headers = Callable[[User], dict[str, str]]

URL = "/api/events"
BODY = {
    "name": "Concert",
    "location": "Expo Tel Aviv, Tel Aviv",
    "starts_at": "2027-01-01T20:00:00+02:00",
    "ends_at": "2027-01-01T23:00:00+02:00",
    "capacity": 50,
    "price_cents": 1000,
}


def test_admin_creates_event(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    admin = make_user(UserRole.ADMIN)

    response = client.post(URL, json=BODY, headers=auth_headers(admin))

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "DRAFT"
    assert body["created_by"] == admin.id
    assert "face_collection_id" not in body


@pytest.mark.parametrize("role", [UserRole.USER, UserRole.GATEKEEPER])
def test_non_admin_cannot_create(
    client: TestClient, make_user: MakeUser, auth_headers: Headers, role: UserRole
) -> None:
    response = client.post(URL, json=BODY, headers=auth_headers(make_user(role)))

    assert response.status_code == 403


def test_create_without_token_returns_401(client: TestClient) -> None:
    assert client.post(URL, json=BODY).status_code == 401


def test_create_invalid_times_returns_422(
    client: TestClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    body = {**BODY, "ends_at": "2027-01-01T19:00:00+02:00"}

    response = client.post(URL, json=body, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 422


def test_user_sees_active_but_not_draft(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user())
    active = make_event(EventStatus.ACTIVE)
    draft = make_event(EventStatus.DRAFT)

    assert client.get(f"{URL}/{active.id}", headers=headers).status_code == 200
    assert client.get(f"{URL}/{draft.id}", headers=headers).status_code == 404


def test_admin_updates_event(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event()

    response = client.put(
        f"{URL}/{event.id}",
        json={"name": "Renamed", "status": "ACTIVE"},
        headers=auth_headers(make_user(UserRole.ADMIN)),
    )

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    assert response.json()["status"] == "ACTIVE"


def test_create_without_venue_and_city_returns_422(client: TestClient, make_user: MakeUser, auth_headers: Headers) -> None:
    response = client.post(URL, json={**BODY, "location": "asdf"}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 422


def test_legacy_location_rule_on_update(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(location="Here")  # older event without a city
    headers = auth_headers(make_user(UserRole.ADMIN))

    untouched = client.put(f"{URL}/{event.id}", json={"name": "Renamed", "location": "Here"}, headers=headers)
    assert (untouched.status_code, untouched.json()["location"]) == (200, "Here")

    changed = client.put(f"{URL}/{event.id}", json={"location": "asdf"}, headers=headers)
    assert (changed.status_code, changed.json()["detail"]) == (422, "location must look like 'Venue, City'")


def test_user_cannot_update(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event()

    response = client.put(f"{URL}/{event.id}", json={"name": "x"}, headers=auth_headers(make_user()))

    assert response.status_code == 403


def test_update_missing_event_returns_404(
    client: TestClient, make_user: MakeUser, auth_headers: Headers
) -> None:
    response = client.put(
        f"{URL}/999999", json={"name": "x"}, headers=auth_headers(make_user(UserRole.ADMIN))
    )

    assert response.status_code == 404


def test_admin_deletes_draft(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    headers = auth_headers(make_user(UserRole.ADMIN))
    event = make_event(EventStatus.DRAFT)

    assert client.delete(f"{URL}/{event.id}", headers=headers).status_code == 204
    assert client.get(f"{URL}/{event.id}", headers=headers).status_code == 404


def test_delete_active_returns_409(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    event = make_event(EventStatus.ACTIVE)

    response = client.delete(f"{URL}/{event.id}", headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 409


def test_catalog_shows_only_active_events(
    client: TestClient, make_user: MakeUser, make_event: MakeEvent, auth_headers: Headers
) -> None:
    active = make_event(EventStatus.ACTIVE)
    make_event(EventStatus.DRAFT)
    make_event(EventStatus.CLOSED)

    response = client.get(URL, headers=auth_headers(make_user()))

    assert response.status_code == 200
    assert [event["id"] for event in response.json()] == [active.id]


def test_catalog_requires_login(client: TestClient) -> None:
    assert client.get(URL).status_code == 401


def test_activation_creates_face_collection(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    event = make_event(EventStatus.DRAFT)

    response = client.put(f"{URL}/{event.id}", json={"status": "ACTIVE"}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 200
    db.refresh(event)
    assert event.face_collection_id == f"bioaccess-event-{event.id}"


def test_activation_returns_503_when_face_provider_down(
    client: TestClient,
    db: Session,
    make_user: MakeUser,
    make_event: MakeEvent,
    auth_headers: Headers,
    face_provider: FakeFaceProvider,
) -> None:
    event = make_event(EventStatus.DRAFT)
    face_provider.available = False

    response = client.put(f"{URL}/{event.id}", json={"status": "ACTIVE"}, headers=auth_headers(make_user(UserRole.ADMIN)))

    assert response.status_code == 503
    db.refresh(event)
    assert event.status == EventStatus.DRAFT
