import {
    loadJSON,
    matchRouteIds,
    calculateTravelTime,
    getRouteStops,
    filterTripsForUpcomingDepartures,
    matchLiveData
} from '../translink-parser';
import Dataframe from '../dataframe';

jest.mock('node:fs/promises');
jest.mock('node-fetch');

describe('translink-parser functions', () => {
    test('matchRouteIds', () => {
        expect(matchRouteIds('66-3734', '66-3735')).toBe(true);
        expect(matchRouteIds('66-3734', '67-3734')).toBe(false);
    });

    test('calculateTravelTime', () => {
        expect(calculateTravelTime('10:00', '10:30')).toBe('30 minutes');
        expect(calculateTravelTime('10:00', '11:30')).toBe('1 hour 30 minutes');
    });

    test('getRouteStops', () => {
        const routesDF = new Dataframe([{ route_id: '66-3734', route_short_name: '66' }]);
        const stopsDF = new Dataframe([
            { stop_id: '1', stop_name: 'Stop 1' },
            { stop_id: '2', stop_name: 'Stop 2' },
        ]);
        const stopTimesDF = new Dataframe([
            { trip_id: 'trip1', stop_id: '1', stop_sequence: '1', direction_id: '0' },
            { trip_id: 'trip1', stop_id: '2', stop_sequence: '2', direction_id: '0' },
        ]);
        const tripsDF = new Dataframe([{ trip_id: 'trip1', route_id: '66-3734' }]);

        const stops = getRouteStops('66', routesDF, stopsDF, stopTimesDF, tripsDF);
        expect(stops.length).toBe(2);
        expect(stops[0].stop_name).toBe('Stop 1');
        expect(stops[1].stop_name).toBe('Stop 2');
    });

    test('filterTripsForUpcomingDepartures', () => {
        const stopTimesDF = new Dataframe([
            { trip_id: 'trip1', stop_id: '1', departure_time: '10:00:00' },
            { trip_id: 'trip2', stop_id: '1', departure_time: '10:05:00' },
        ]);
        const tripsDF = new Dataframe([
            { trip_id: 'trip1', route_id: '66-3734', service_id: 'service1' },
            { trip_id: 'trip2', route_id: '66-3734', service_id: 'service1' },
        ]);
        const routesDF = new Dataframe([{ route_id: '66-3734', route_short_name: '66' }]);
        const calendarDF = new Dataframe([
            { service_id: 'service1', monday: '1', tuesday: '1', wednesday: '1', thursday: '1', friday: '1', saturday: '1', sunday: '1', start_date: '20240101', end_date: '20241231' },
        ]);
        const calendarDatesDF = new Dataframe([]);

        const currentDateTime = new Date('2024-08-29T09:55:00+10:00');
        const startStop = { stop_id: '1' };
        const endStop = { stop_id: '2' };

        const upcomingTrips = filterTripsForUpcomingDepartures(
            stopTimesDF, tripsDF, routesDF, '66', startStop, endStop, currentDateTime, calendarDF, calendarDatesDF
        );

        console.log('Upcoming Trips:', upcomingTrips);

        expect(upcomingTrips.length).toBe(2);
        expect(upcomingTrips[0].startStopTime.departure_time).toBe('10:00:00');
        expect(upcomingTrips[1].startStopTime.departure_time).toBe('10:05:00');
    });

    test('matchLiveData', () => {
        const tripUpdates = [
            {
                tripUpdate: {
                    trip: { tripId: 'trip1', routeId: '66-3734' },
                    stopTimeUpdate: [
                        { stopId: '1', arrival: { time: '1624932800' } }
                    ]
                }
            }
        ];
        const vehiclePositions = [
            {
                vehicle: {
                    trip: { tripId: 'trip1', routeId: '66-3734' },
                    position: { latitude: -27.5, longitude: 153.0 }
                }
            }
        ];
        const stopTime = { stop_id: '1' };
        const routeId = '66-3734';
        const tripId = 'trip1';
        new Date('2024-08-29T10:00:00+10:00');
        const liveData = matchLiveData(tripUpdates, vehiclePositions, stopTime, routeId, tripId);

        expect(liveData.liveArrivalTime).not.toBe('N/A');
        expect(liveData.livePosition).toBe('-27.5, 153');
    });
});