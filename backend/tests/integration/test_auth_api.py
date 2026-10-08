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


LOGIN_URL = "/api/auth/login"


def test_login_returns_bearer_token(client: TestClient) -> None:
    client.post(REGISTER_URL, json=VALID_BODY)

    response = client.post(LOGIN_URL, json={"email": "dana@example.com", "password": "s3cret-pass"})

    assert response.status_code == 200
    body = response.json()
    assert body["token_type"] == "bearer"
    assert body["access_token"]


def test_login_wrong_password_and_unknown_email_look_the_same(client: TestClient) -> None:
    client.post(REGISTER_URL, json=VALID_BODY)

    wrong_password = client.post(LOGIN_URL, json={"email": "dana@example.com", "password": "wrong-pass"})
    unknown_email = client.post(LOGIN_URL, json={"email": "nobody@example.com", "password": "s3cret-pass"})

    assert wrong_password.status_code == unknown_email.status_code == 401
    assert wrong_password.json() == unknown_email.json()


def test_me_returns_logged_in_user(client: TestClient) -> None:
    client.post(REGISTER_URL, json=VALID_BODY)
    token = client.post(
        LOGIN_URL, json={"email": "dana@example.com", "password": "s3cret-pass"}
    ).json()["access_token"]

    response = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json()["email"] == "dana@example.com"


def test_me_without_token_returns_401(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
