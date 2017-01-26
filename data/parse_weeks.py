import csv
import re

FILE = "transaktioner-2014.csv"
OUT = "transactions-dec-2014.csv"

rows = []

with open(FILE, "r") as fIn:
    reader = csv.reader(fIn)
    with open(OUT, "w") as fOut:
        writer = csv.writer(fOut)
        for row in reader:
            if re.search(r'2014-12-(15|16|17|18|19|20|21)', row[2]):
                writer.writerow(row)
