"""Format the Cloudflare GraphQL responses used by stats.sh."""

import json
import sys


def die(errors):
    print("  error: " + "; ".join(e.get("message", "?") for e in errors))
    sys.exit(0)


def main():
    kind = sys.argv[1]
    payload = json.load(sys.stdin)
    if payload.get("errors"):
        die(payload["errors"])

    viewer = payload["data"]["viewer"]

    if kind == "daily":
        rows = viewer["zones"][0]["httpRequests1dGroups"]
        if not rows:
            print("  no data yet")
            return
        print("  %-12s %9s %10s %9s %10s" % ("DATE", "REQUESTS", "PAGEVIEWS", "UNIQUES", "DATA"))
        totals = [0, 0, 0]
        for r in rows:
            s, u = r["sum"], r["uniq"]
            totals = [totals[0] + s["requests"], totals[1] + s["pageViews"], totals[2] + u["uniques"]]
            print("  %-12s %9d %10d %9d %9.1fMB" % (
                r["dimensions"]["date"], s["requests"], s["pageViews"],
                u["uniques"], s["bytes"] / 1048576.0))
        print("  %-12s %9d %10d %9d" % ("TOTAL", totals[0], totals[1], totals[2]))

    elif kind == "hosts":
        rows = viewer["zones"][0]["httpRequestsAdaptiveGroups"]
        if not rows:
            print("  no data yet")
            return
        print("  %-24s %-10s %8s" % ("HOST", "COUNTRY", "REQUESTS"))
        for r in rows:
            d = r["dimensions"]
            print("  %-24s %-10s %8d" % (
                d["clientRequestHTTPHost"], d["clientCountryName"], r["count"]))

    elif kind == "worker":
        rows = viewer["accounts"][0]["workersInvocationsAdaptive"]
        if not rows:
            print("  no requests in the last 24h")
            return
        print("  %-12s %9s %8s" % ("STATUS", "REQUESTS", "ERRORS"))
        for r in rows:
            print("  %-12s %9d %8d" % (
                r["dimensions"]["status"], r["sum"]["requests"], r["sum"]["errors"]))


main()
