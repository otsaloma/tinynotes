# -*- coding: utf-8 -*-

from db import ALLOWED_USERS
from db import lambda_handler

def make_event(method, email=None):
    event = {
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "email": email,
                    },
                },
            },
            "http": {
                "method": method,
            },
        },
    }
    if not email:
        del event["requestContext"]["authorizer"]
    return event

def test_get():
    event = make_event("GET", ALLOWED_USERS[0])
    value = lambda_handler(event, {})
    assert value["statusCode"] == 200
    assert value["body"]

def test_get_allowed_users():
    event = make_event("GET", "xxx@yyy.zzz")
    value = lambda_handler(event, {})
    assert value["statusCode"] == 403
    assert value["body"] == "Forbidden"

def test_options():
    event = make_event("OPTIONS")
    value = lambda_handler(event, {})
    assert value["statusCode"] == 200
    assert value["body"] == ""
