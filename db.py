#!/usr/bin/env python3

import json
import os

import boto3

BUCKET = os.environ["BUCKET"]
MAX_BACKUPS = 50
ALLOWED_USERS = os.environ["ALLOWED_USERS"].split(":")

s3 = boto3.client("s3")


def get_email(event):
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    email = claims["email"]
    if email not in ALLOWED_USERS:
        return None
    return email


def get_notes(email):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=f"{email}/notes.json")
        data = json.loads(response["Body"].read())
    except s3.exceptions.NoSuchKey:
        data = {"items": [], "version": 0}
    prune_backups(email)
    return data


def put_notes(email, body):
    try:
        response = s3.get_object(Bucket=BUCKET, Key=f"{email}/notes.json")
        current = json.loads(response["Body"].read())
        current_version = current.get("version", 0)
    except s3.exceptions.NoSuchKey:
        current_version = 0
    if body.get("version") != current_version:
        return None
    new_version = current_version + 1
    body["version"] = new_version
    data = json.dumps(body)
    s3.put_object(Bucket=BUCKET, Key=f"{email}/notes.json", Body=data)
    s3.put_object(Bucket=BUCKET, Key=f"{email}/bak/{new_version}.json",
                  Body=data)
    return new_version


def prune_backups(email):
    prefix = f"{email}/bak/"
    response = s3.list_objects_v2(Bucket=BUCKET, Prefix=prefix)
    objects = response.get("Contents", [])
    if len(objects) <= MAX_BACKUPS:
        return
    objects.sort(key=lambda o: o["Key"])
    to_delete = objects[:len(objects) - MAX_BACKUPS]
    s3.delete_objects(Bucket=BUCKET, Delete={
        "Objects": [{"Key": o["Key"]} for o in to_delete]
    })


def lambda_handler(event, context):
    method = event["requestContext"]["http"]["method"]
    if method == "OPTIONS":
        return {"statusCode": 200, "body": ""}
    email = get_email(event)
    if not email:
        return {"statusCode": 403, "body": "Forbidden"}
    if method == "GET":
        data = get_notes(email)
        return {"statusCode": 200, "body": json.dumps(data)}
    if method == "POST":
        body = json.loads(event.get("body", "{}"))
        new_version = put_notes(email, body)
        if new_version is None:
            return {"statusCode": 409, "body": "Version conflict"}
        return {"statusCode": 200, "body": json.dumps({
            "version": new_version
        })}
    return {"statusCode": 405, "body": "Method not allowed"}
