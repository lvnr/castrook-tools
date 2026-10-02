import os
from castrook import Castrook, CastrookError

with Castrook(api_key=os.environ["CASTROOK_API_KEY"]) as api:
    account = api.accounts.create_test({
        "platform": "facebook",
        "name": "API demo",
    })["data"]
    post = api.posts.create({
        "text": "Hello from Castrook.",
        "account_ids": [account["id"]],
        "platform_options": {
            "facebook": {"sandbox_outcome": "published"}
        },
    }, idempotency_key="api-demo-first-post-v1")["data"]
    result = api.posts.wait(post["id"], timeout=300, poll_interval=1)["data"]
    print(result["status"], result["targets"])
