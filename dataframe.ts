import { promises as fs } from "fs";
import { parse } from "csv-parse";

export default class Dataframe {
    data: any[];

    /**
     * Creates an instance of Dataframe.
     * @param {any[]} data - An array of data to initialize the dataframe.
     */
    constructor(data: any[]) {
        this.data = data;
    }

    /**
     * Loads a CSV file and returns a Dataframe instance.
     * @param {string} filePath - The path to the CSV file.
     * @returns {Promise<Dataframe>} - A promise that resolves to a Dataframe instance containing the loaded data.
     */
    static async loadCSV(filePath: string): Promise<Dataframe> {
        const content = await fs.readFile(filePath, 'utf-8');
        return new Promise((resolve, reject) => {
            parse(content, { columns: true }, (err, records) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(new Dataframe(records));
                }
            });
        });
    }

    /**
     * Joins the current Dataframe with another Dataframe on a specified key.
     * @param {Dataframe} other - The other Dataframe to join with.
     * @param {string} key - The key to join on.
     * @param {boolean} [keepUnmatched=false] - Whether to keep unmatched rows from the current Dataframe.
     * @returns {Dataframe} - A new Dataframe containing the joined data.
     */
    join(other: Dataframe, key: string, keepUnmatched: boolean = false): Dataframe {
        const joinedData = this.data.flatMap(row => {
            const matchingRows = other.data.filter(otherRow => otherRow[key] === row[key]);
            if (matchingRows.length > 0) {
                return matchingRows.map(matchingRow => ({ ...row, ...matchingRow }));
            } else if (keepUnmatched) {
                return [{ ...row }];
            }
            return [];
        });
        return new Dataframe(joinedData);
    }

    /**
     * Selects specific columns from the Dataframe.
     * @param {string[]} columns - The columns to select.
     * @returns {Dataframe} - A new Dataframe containing only the selected columns.
     */
    select(columns: string[]): Dataframe {
        const selectedData = this.data.map(row => {
            const newRow: Record<string, any> = {};
            columns.forEach(col => {
                if (row.hasOwnProperty(col)) {
                    newRow[col] = row[col];
                }
            });
            return newRow;
        });
        return new Dataframe(selectedData);
    }

    /**
     * Removes duplicate rows based on a specific column.
     * @param {string} column - The column to check for duplicates.
     * @returns {Dataframe} - A new Dataframe with duplicate rows removed.
     */
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

    /**
     * Filters the Dataframe based on a provided criteria function.
     * @param {(row: any) => boolean} criteria - The criteria function to filter rows.
     * @returns {Dataframe} - A new Dataframe with rows that match the criteria.
     */
    filter(criteria: (row: any) => boolean): Dataframe {
        return new Dataframe(this.data.filter(criteria));
    }

    /**
     * Sorts the Dataframe based on a specific key.
     * @param {string} key - The key to sort by.
     * @param {boolean} [ascending=true] - Whether to sort in ascending order.
     * @returns {Dataframe} - A new Dataframe with sorted rows.
     */
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
