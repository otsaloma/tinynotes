#!/usr/bin/env python3

import boto3
import json
import os

ALLOWED_USERS = os.environ["ALLOWED_USERS"].split(":")
BUCKET = os.environ["BUCKET"]
s3 = boto3.client("s3")

def get_notes(email):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=f"{email}/notes.json")
        data = json.loads(response["Body"].read())
        prune_backups(email)
        return data
    except s3.exceptions.NoSuchKey:
        # First call for a new user with no notes yet.
        return {"items": [], "version": 0}

def put_notes(email, data):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=f"{email}/notes.json")
        current = json.loads(response["Body"].read())
        current_version = current["version"]
    except s3.exceptions.NoSuchKey:
        # First call for a new user with no notes yet.
        current_version = 0
    # Only allow put for new data that is based on the current version.
    # In case of concurrent use, one device might have started a session
    # based on an earlier version.
    if data["version"] != current_version:
        return None
    new_version = current_version + 1
    data["version"] = new_version
    body = json.dumps(data)
    s3.put_object(Bucket=BUCKET, Key=f"{email}/notes.json", Body=body)
    s3.put_object(Bucket=BUCKET, Key=f"{email}/bak/{new_version}.json", Body=body)
    return new_version

def prune_backups(email, keep=100):
    prefix = f"{email}/bak/"
    response = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    objects = response.get("Contents", [])
    if len(objects) <= keep: return
    # Sort by version: 1.json, 2.json, 3.json, ...
    objects.sort(key=lambda x: int(x["Key"].split("/")[-1].split(".")[0]))
    oldest = objects[:len(objects)-keep]
    s3.delete_objects(Bucket=BUCKET, Delete={
        "Objects": [{"Key": x["Key"]} for x in oldest]
    })

def response(status_code, body):
    return {"statusCode": status_code, "body": body}

def lambda_handler(event, context):
    method = event["requestContext"]["http"]["method"]
    if method == "OPTIONS":
        return response(200, "")
    # Check JWT email against ALLOWED_USERS. API Gateway already
    # checks this, but we keep a check here also, just in case.
    email = event["requestContext"]["authorizer"]["jwt"]["claims"]["email"]
    if email not in ALLOWED_USERS:
        return response(403, "Forbidden")
    if method == "GET":
        data = get_notes(email)
        body = json.dumps(data)
        return response(200, body)
    if method == "POST":
        body = event.get("body", "{}")
        data = json.loads(body)
        new_version = put_notes(email, data)
        if new_version is None:
            return response(409, "Trying to put data based on an obsolete version")
        return response(200, json.dumps({"version": new_version}))
    # We should not reach this given method limits in API Gateway.
    return response(405, "Method not allowed")

if __name__ == "__main__":

    # OPTIONS
    value = lambda_handler({
        "requestContext": {
            "http": {
                "method": "OPTIONS",
            },
        },
    }, {})
    assert value["statusCode"] == 200

    # ALLOWED_USERS
    value = lambda_handler({
        "requestContext": {
            "authorizer": {
                "jwt": {
                    "claims": {
                        "email": "xxx@yyy.zzz",
                    },
                },
            },
            "http": {
                "method": "GET",
            },
        },
    }, {})
    assert value["statusCode"] == 403
