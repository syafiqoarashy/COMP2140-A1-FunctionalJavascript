import promptSync from 'prompt-sync';
import {parse} from "csv-parse";
import * as fs from "node:fs/promises";
import fetch from 'node-fetch';
import * as path from 'path';
import {Route, Stop, StopTime, Trip} from "./commons";

const prompt = promptSync();
const CACHE_DIR = './cached-data';
const CACHE_DURATION = 5 * 60 * 1000;

const loadCSV = async (filePath: string): Promise<any[]> => {
    const content = await fs.readFile(filePath, 'utf-8');
    return new Promise((resolve, reject) => {
        parse(content, { columns: true }, (err, records) => {
            if (err) reject(err);
            else resolve(records);
        });
    });
};

const loadJSON = async (url: string, cacheFile: string): Promise<any> => {
    const cachePath = path.join(CACHE_DIR, cacheFile);

    try {
        const stats = await fs.stat(cachePath);
        const now = Date.now();

        if (now - stats.mtimeMs < CACHE_DURATION) {
            return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        }
    } catch (err) {}

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch data from ${url}`);
    }
    const data = await response.json();

    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
};

const matchRouteIds = (staticRouteId: string, realtimeRouteId: string): boolean => {
    const staticMainRoute = staticRouteId.split('-')[0];
    const realtimeMainRoute = realtimeRouteId.split('-')[0];
    return staticMainRoute === realtimeMainRoute;
};

const getRoute = (routes: Route[]): string => {
    while (true) {
        const route = prompt("What Bus Route would you like to take? ");
        if (route && routes.some(r => r.route_short_name === route)) {
            return route;
        }
        console.log("Please enter a valid bus route.");
    }
};

const getRouteStops = (
    route: string,
    routes: Route[],
    stops: Stop[],
    stopTimes: StopTime[],
    trips: Trip[]
): Stop[] => {
    const routeInfo = routes.find(r => r.route_short_name === route);
    if (!routeInfo) return [];

    const routeTrips = trips.filter(trip => trip.route_id === routeInfo.route_id);

    let allStopTimes: {stop: Stop, sequence: number, direction: number}[] = [];

    routeTrips.forEach(trip => {
        const tripStopTimes = stopTimes
            .filter(st => st.trip_id === trip.trip_id)
            .map(st => ({
                stop: stops.find(stop => stop.stop_id === st.stop_id) as Stop,
                sequence: st.stop_sequence,
                direction: trip.direction_id
            }))
            .filter(item => item.stop);

        allStopTimes = allStopTimes.concat(tripStopTimes);
    });

    allStopTimes.sort((a, b) => {
        if (a.direction !== b.direction) return a.direction - b.direction;
        return a.sequence - b.sequence;
    });

    const uniqueStops = allStopTimes.filter((item, index, self) =>
        index === self.findIndex((t) => t.stop.stop_id === item.stop.stop_id && t.direction === item.direction)
    );

    return uniqueStops.map(item => item.stop);
};

const getStartAndEndStops = (stops: Stop[]): { start: Stop, end: Stop } | null => {
    while (true) {
        const input = prompt("What is your start and end stop on the route? (e.g., 1 - 2) ");
        const match = input.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);

        if (!match) {
            console.log("Please follow the format and enter a valid number for the stop.");
            continue;
        }

        const [, startIndex, endIndex] = match.map(Number);

        if (startIndex < 1 || startIndex > stops.length ||
            endIndex < 1 || endIndex > stops.length ||
            startIndex >= endIndex) {
            console.log("Please enter valid stop numbers within the range of available stops.");
            continue;
        }

        return {
            start: stops[startIndex - 1],
            end: stops[endIndex - 1]
        };
    }
};

const getDate = (): string => {
    while (true) {
        const input = prompt("What date will you take the route? (YYYY-MM-DD) ");
        if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
            const date = new Date(input + 'T00:00:00+10:00');
            if (!isNaN(date.getTime())) {
                return input;
            }
        }
        console.log("Incorrect date format. Please use YYYY-MM-DD.");
    }
};

const getTime = (): string => {
    while (true) {
        const input = prompt("What time will you leave? (HH:mm) ");
        if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(input)) {
            return input;
        }
        console.log("Incorrect time format. Please use HH:mm.");
    }
};

const filterTripsForUpcomingDepartures = (
    stopTimes: StopTime[],
    trips: Trip[],
    startStop: Stop,
    endStop: Stop,
    currentDateTime: Date
) => {
    const tenMinutesLater = new Date(currentDateTime.getTime() + 10 * 60000);

    console.log(`Filtering trips for start stop: ${startStop.stop_id}`);
    console.log(`Current date/time: ${currentDateTime.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);

    const filteredStopTimes = stopTimes.filter(stopTime => {
        if (stopTime.stop_id === startStop.stop_id) {
            const arrivalTime = stopTime.arrival_time || stopTime.departure_time;
            const arrivalDateTime = new Date(`${currentDateTime.toISOString().split('T')[0]}T${arrivalTime}+10:00`);
            return arrivalDateTime >= currentDateTime && arrivalDateTime <= tenMinutesLater;
        }
        return false;
    });

    console.log(`Filtered stop times: ${filteredStopTimes.length}`);

    return filteredStopTimes.map(startStopTime => {
        const trip = trips.find(t => t.trip_id === startStopTime.trip_id);
        const endStopTime = stopTimes.find(st => st.trip_id === startStopTime.trip_id && st.stop_id === endStop.stop_id);
        return { startStopTime, endStopTime, routeId: trip ? trip.route_id : '' };
    });
};

const matchLiveData = (tripUpdates: any[], vehiclePositions: any[], stopTime: StopTime, routeId: string) => {
    const relevantTripUpdates = tripUpdates.filter(update => {
        if (!update.tripUpdate || !update.tripUpdate.trip || !update.tripUpdate.stopTimeUpdate) {
            return false;
        }

        return matchRouteIds(routeId, update.tripUpdate.trip.routeId) &&
            update.tripUpdate.stopTimeUpdate.some((stu: any) => stu.stopId === stopTime.stop_id);
    });

    if (relevantTripUpdates.length === 0) {
        return null;
    }

    const closestTripUpdate = relevantTripUpdates.reduce((closest, current) => {
        const closestTime = closest.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id)?.arrival?.time || 0;
        const currentTime = current.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id)?.arrival?.time || 0;
        const scheduledTime = new Date(`2024-08-27T${stopTime.arrival_time}`).getTime() / 1000;

        return Math.abs(currentTime - scheduledTime) < Math.abs(closestTime - scheduledTime) ? current : closest;
    });

    const relevantVehiclePosition = vehiclePositions.find(position =>
        matchRouteIds(routeId, position.vehicle.trip.routeId) &&
        position.vehicle.trip.tripId === closestTripUpdate.tripUpdate.trip.tripId
    );

    const stopTimeUpdate = closestTripUpdate.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id);

    return {
        liveArrivalTime: stopTimeUpdate?.arrival?.time
            ? new Date(stopTimeUpdate.arrival.time * 1000).toISOString().split('T')[1].slice(0, 5)
            : 'N/A',
        livePosition: relevantVehiclePosition
            ? `${relevantVehiclePosition.vehicle.position.latitude}, ${relevantVehiclePosition.vehicle.position.longitude}`
            : 'N/A',
    };
};

const calculateTravelTime = (startTime: string, endTime: string): string => {
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    let diff = end.getTime() - start.getTime();

    if (diff < 0) {
        diff += 24 * 60 * 60 * 1000;
    }

    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const main = async () => {
    console.log("Welcome to the South East Queensland Route Planner!");

    const routes = await loadCSV('./static-data/routes.txt') as Route[];
    const stops = await loadCSV('./static-data/stops.txt') as Stop[];
    const stopTimes = await loadCSV('./static-data/stop_times.txt') as StopTime[];
    const trips = await loadCSV('./static-data/trips.txt') as Trip[];

    const tripUpdates = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/trip_updates.json', 'trip_updates.json')).entity;
    const vehiclePositions = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/vehicle_positions.json', 'vehicle_positions.json')).entity;
    const alerts = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/alerts.json', 'alerts.json')).entity;

    while (true) {
        const route = getRoute(routes);
        const stopsForRoute = getRouteStops(route, routes, stops, stopTimes, trips);

        if (stopsForRoute.length === 0) {
            console.log("No stops found for this route. Please enter a valid bus route.");
            continue;
        }

        console.log("Stops for this route:");
        stopsForRoute.forEach((stop, index) => {
            console.log(`${index + 1}. ${stop.stop_name}`);
        });

        const startAndEndStops = getStartAndEndStops(stopsForRoute);
        if (!startAndEndStops) {
            console.log("Failed to get valid start and end stops. Please try again.");
            continue;
        }

        console.log(`You've selected to travel from "${startAndEndStops.start.stop_name}" to "${startAndEndStops.end.stop_name}".`);

        const date = getDate();
        const time = getTime();
        const currentDateTime = new Date(`${date}T${time}+10:00`);

        console.log(`You've chosen to travel on ${date} at ${time}.`);

        const upcomingStopTimes = filterTripsForUpcomingDepartures(stopTimes, trips, startAndEndStops.start, startAndEndStops.end, currentDateTime);

        const result = upcomingStopTimes.map(({ startStopTime, endStopTime, routeId }) => {
            const trip = trips.find(trip => trip.trip_id === startStopTime.trip_id);
            const routeDetails = routes.find(route => route.route_id === routeId);

            const liveData = matchLiveData(tripUpdates, vehiclePositions, startStopTime, routeId);

            const estimatedTravelTime = endStopTime
                ? calculateTravelTime(startStopTime.departure_time || startStopTime.arrival_time, endStopTime.arrival_time || endStopTime.departure_time)
                : "N/A";

            return {
                "Route Short Name": routeDetails?.route_short_name || "N/A",
                "Route Long Name": routeDetails?.route_long_name || "N/A",
                "Service ID": trip?.service_id || "N/A",
                "Heading Sign": trip?.trip_headsign || "N/A",
                "Scheduled Arrival Time": startStopTime.arrival_time || startStopTime.departure_time,
                "Live Arrival Time": liveData?.liveArrivalTime || "N/A",
                "Live Position": liveData?.livePosition || "N/A",
                "Estimated Travel Time": estimatedTravelTime,
            };
        });

        if (result.length > 0) {
            console.table(result);
        } else {
            console.log("No upcoming trips found within the next 10 minutes.");
        }

        const replay = (prompt('Would you like to search again? (y/n) ') || "").toLowerCase();
        if (replay !== 'y' && replay !== 'yes') break;
    }

    console.log("Thanks for using the Route Tracker!");
};

main().catch(console.error);
