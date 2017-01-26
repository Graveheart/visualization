import csv
from datetime import datetime, timedelta
import json
import re
from collections import defaultdict

SPAN = 60 * 60

MACHINES_OUT  = "meters_data.json"
TRANSACTIONS = [
    { "season" : "s", "path" : "transactions-aug-2014.csv" },
    { "season" : "w", "path" : "transactions-dec-2014.csv" }
]

def to_time(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M:%S")

def to_time_offset(d):
    d0 = d.replace(hour=0, minute=0, second=0, microsecond=0)
    secs = (d - d0).seconds
    return secs - (secs % SPAN)

# Do it: season-day-time-pid => { count, sum }
span = timedelta(seconds=SPAN)
res = defaultdict(lambda: defaultdict(int))
for config in TRANSACTIONS:
    with open(config["path"], "r") as f:
        transactions = list(csv.reader(f))
        for row in transactions:
            if len(row[2]) > 0 and len(row[3]) > 0:
                ident = row[1]
                start = to_time(row[2])
                end = to_time(row[3])
                diff = (end - start).seconds
                while start < end:
                    time = to_time_offset(start)
                    key = config["season"] + "-" + str(start.weekday()) + "-" + str(time) + "-" + str(ident)
                    res[key]["c"] += 1
                    res[key]["s"] += diff
                    start = start + span

# Save machines out
with open(MACHINES_OUT, "w") as f:
    json.dump(res, f)
