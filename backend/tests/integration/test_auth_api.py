from fastapi.testclient import TestClient

REGISTER_URL = "/api/auth/register"
VALID_BODY = {"email": "dana@example.com", "full_name": "Dana Levi", "password": "s3cret-pass"}


def test_register_returns_201_without_password(client: TestClient) -> None:
    response = client.post(REGISTER_URL, json=VALID_BODY)

    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "dana@example.com"
    assert body["role"] == "USER"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_twice_returns_409(client: TestClient) -> None:
    client.post(REGISTER_URL, json=VALID_BODY)
    response = client.post(REGISTER_URL, json=VALID_BODY)

    assert response.status_code == 409


def test_register_invalid_email_returns_422(client: TestClient) -> None:
    response = client.post(REGISTER_URL, json={**VALID_BODY, "email": "not-an-email"})

    assert response.status_code == 422


def test_register_short_password_returns_422(client: TestClient) -> None:
    response = client.post(REGISTER_URL, json={**VALID_BODY, "password": "short"})

    assert response.status_code == 422


def test_register_cannot_choose_role(client: TestClient) -> None:
    response = client.post(REGISTER_URL, json={**VALID_BODY, "role": "ADMIN"})

    assert response.status_code == 201
    assert response.json()["role"] == "USER"
