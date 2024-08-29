import fs from "node:fs/promises";
import {parse} from "csv-parse";

export default class Dataframe {
    data: any[];

    constructor(data: any[]) {
        this.data = data;
    }

    static async loadCSV(filePath: string): Promise<Dataframe> {
        console.log(`Loading CSV file: ${filePath}`);
        const content = await fs.readFile(filePath, 'utf-8');
        return new Promise((resolve, reject) => {
            parse(content, { columns: true }, (err, records) => {
                if (err) {
                    console.error(`Error parsing CSV file ${filePath}: ${err}`);
                    reject(err);
                } else {
                    console.log(`Loaded ${records.length} records from ${filePath}`);
                    if (records.length > 0) {
                        console.log(`Sample record: ${JSON.stringify(records[0])}`);
                    }
                    resolve(new Dataframe(records));
                }
            });
        });
    }

    join(other: Dataframe, key: string, keepUnmatched: boolean = false): Dataframe {
        const joinedData = this.data.flatMap(row => {
            const matchingRows = other.data.filter(otherRow => otherRow[key] === row[key]);
            if (matchingRows.length > 0) {
                return matchingRows.map(matchingRow => ({ ...row, ...matchingRow }));
            } else if (keepUnmatched) {
                console.log(`No match found for key "${key}" in row: ${JSON.stringify(row)}`);
                return [{ ...row }];
            }
            return [];
        });
        console.log(`Join result with key "${key}":`, JSON.stringify(joinedData[0], null, 2));
        return new Dataframe(joinedData);
    }

    select(columns: string[]): Dataframe {
        const selectedData = this.data.map(row => {
            const newRow: any = {};
            columns.forEach(col => {
                if (row.hasOwnProperty(col)) {
                    newRow[col] = row[col];
                }
            });
            return newRow;
        });
        return new Dataframe(selectedData);
    }

    distinct(column: string): Dataframe {
        const seen = new Set();
        const distinctData = this.data.filter(row => {
            const key = row[column];
            if (seen.has(key)) {
                return false;
            } else {
                seen.add(key);
                return true;
            }
        });
        return new Dataframe(distinctData);
    }

    filter(criteria: (row: any) => boolean): Dataframe {
        return new Dataframe(this.data.filter(criteria));
    }

    sort(key: string, ascending: boolean = true): Dataframe {
        const sortedData = [...this.data].sort((a, b) => {
            const aValue = parseFloat(a[key]);
            const bValue = parseFloat(b[key]);

            if (isNaN(aValue) || isNaN(bValue)) {
                if (a[key] < b[key]) return ascending ? -1 : 1;
                if (a[key] > b[key]) return ascending ? 1 : -1;
                return 0;
            }

            return ascending ? aValue - bValue : bValue - aValue;
        });

        return new Dataframe(sortedData);
    }

}
