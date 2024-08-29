import Dataframe from '../dataframe';

describe('Dataframe', () => {
    let df: Dataframe;

    beforeEach(() => {
        df = new Dataframe([
            { id: 1, name: 'Alice', age: 30 },
            { id: 2, name: 'Bob', age: 25 },
            { id: 3, name: 'Charlie', age: 35 },
        ]);
    });

    test('filter', () => {
        const filtered = df.filter(row => row.age > 25);
        expect(filtered.data.length).toBe(2);
        expect(filtered.data[0].name).toBe('Alice');
        expect(filtered.data[1].name).toBe('Charlie');
    });

    test('select', () => {
        const selected = df.select(['name', 'age']);
        expect(selected.data[0]).toEqual({ name: 'Alice', age: 30 });
        expect(selected.data[0]).not.toHaveProperty('id');
    });

    test('distinct', () => {
        const dfWithDuplicates = new Dataframe([
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' },
            { id: 3, name: 'Alice' },
        ]);
        const distinct = dfWithDuplicates.distinct('name');
        expect(distinct.data.length).toBe(2);
    });

    test('sort', () => {
        const sorted = df.sort('age');
        expect(sorted.data[0].name).toBe('Bob');
        expect(sorted.data[2].name).toBe('Charlie');
    });

    test('join', () => {
        const otherDf = new Dataframe([
            { id: 1, city: 'New York' },
            { id: 2, city: 'London' },
        ]);
        const joined = df.join(otherDf, 'id');
        expect(joined.data.length).toBe(2);
        expect(joined.data[0]).toHaveProperty('city');
        expect(joined.data[0].city).toBe('New York');
    });
});