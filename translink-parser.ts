import promptSync from 'prompt-sync';
import { parse } from "csv-parse";
import * as fs from "node:fs/promises";
import fetch from 'node-fetch';
import * as path from 'path';
import { Route, Stop, StopTime, Trip } from "./commons";

const prompt = promptSync();
const CACHE_DIR = './cached-data';
const CACHE_DURATION = 5 * 60 * 1000;

const pipe = (...fns: Function[]) => (x: any) => fns.reduce((v, f) => f(v), x);

const loadCSV = async (path: string): Promise<any[]> => {
    const content = await fs.readFile(path, 'utf-8');
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
            console.log(`Loading data from cache: ${cacheFile}`);
            return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        }
    } catch (err) {}

    console.log(`Fetching new data from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch data from ${url}`);
    }
    const data = await response.json();

    await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
};

const getRoute = (): string => {
    while (true) {
        const route = prompt("What Bus Route would you like to take? ");
        if (route) {
            return route;
        }
        console.log("Invalid input. Please enter a valid bus route.");
    }
};

const getRouteStops = (
    route: string,
    routes: Route[],
    stops: Stop[],
    stopTimes: StopTime[],
    trips: Trip[]
): Stop[] => {
    const findRoute = (routes: Route[]) => routes.find(r => r.route_short_name === route);

    const findTripsByRouteId = (routeId: string) => (trips: Trip[]) =>
        trips.filter(trip => trip.route_id === routeId);

    const filterStopTimesByTripIds = (tripIds: string[]) => (stopTimes: StopTime[]) =>
        stopTimes.filter(st => tripIds.includes(st.trip_id));

    const getUniqueStopIds = (stopTimes: StopTime[]) =>
        [...new Set(stopTimes.map(st => st.stop_id))];

    const filterStopsByIds = (stops: Stop[]) => (stopIds: string[]) =>
        stops.filter(stop => stopIds.includes(stop.stop_id));

    return pipe(
        findRoute,
        (route: Route | undefined) => route ? route.route_id : '',
        (routeId: string) => {
            if (!routeId) return [];
            const routeTrips = findTripsByRouteId(routeId)(trips);
            const tripIds = routeTrips.map(trip => trip.trip_id);
            return filterStopTimesByTripIds(tripIds)(stopTimes);
        },
        getUniqueStopIds,
        (stopIds: string[]) => filterStopsByIds(stops)(stopIds)
    )(routes);
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
            const date = new Date(input);
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
    startStop: Stop,
    currentDateTime: Date
) => {
    const tenMinutesLater = new Date(currentDateTime.getTime() + 10 * 60000);

    return stopTimes.filter(stopTime => {
        if (stopTime.stop_id === startStop.stop_id) {
            const arrivalTime = stopTime.arrival_time || stopTime.departure_time;
            const arrivalDateTime = new Date(`${currentDateTime.toISOString().split('T')[0]}T${arrivalTime}`);
            return arrivalDateTime >= currentDateTime && arrivalDateTime <= tenMinutesLater;
        }
        return false;
    });
};

const matchLiveData = (tripUpdates: any[], vehiclePositions: any[], stopTime: StopTime, tripId: string) => {
    console.log(`Matching live data for tripId: ${tripId} and stopId: ${stopTime.stop_id}`);

    const liveTrip = tripUpdates.find(update => update.tripUpdate.trip.tripId === tripId);
    if (!liveTrip) {
        console.log(`No live trip data found for tripId: ${tripId}`);
        return null;
    }

    const stopUpdate = liveTrip.tripUpdate.stopTimeUpdate.find(
        (update: any) => update.stopId === stopTime.stop_id
    );

    const vehicle = vehiclePositions.find(
        position => position.vehicle.trip.tripId === tripId
    );

    if (!stopUpdate || !vehicle) {
        console.log(`No matching stop update or vehicle position found for tripId: ${tripId}`);
        return null;
    }

    console.log(`Live data found for tripId: ${tripId} at stopId: ${stopTime.stop_id}`);

    return {
        liveArrivalTime: new Date(stopUpdate.arrival.time * 1000).toISOString().split('T')[1],
        livePosition: `${vehicle.vehicle.position.latitude}, ${vehicle.vehicle.position.longitude}`,
    };
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
        const route = getRoute();
        const stopsForRoute = getRouteStops(route, routes, stops, stopTimes, trips);

        if (stopsForRoute.length === 0) {
            console.log("No stops found for this route. Please enter a valid bus route.");
            continue;
        }

        console.log("Stops for this route:");
        stopsForRoute.forEach((stop, index) => console.log(`${index + 1}. ${stop.stop_name}`));

        const startAndEndStops = getStartAndEndStops(stopsForRoute);
        if (!startAndEndStops) {
            console.log("Failed to get valid start and end stops. Please try again.");
            continue;
        }

        console.log(`You've selected to travel from "${startAndEndStops.start.stop_name}" to "${startAndEndStops.end.stop_name}".`);

        const date = getDate();
        const time = getTime();
        const currentDateTime = new Date(`${date}T${time}`);

        console.log(`You've chosen to travel on ${date} at ${time}.`);

        const upcomingStopTimes = filterTripsForUpcomingDepartures(stopTimes, startAndEndStops.start, currentDateTime);

        const result = upcomingStopTimes.map(stopTime => {
            const trip = trips.find(trip => trip.trip_id === stopTime.trip_id);
            const routeDetails = routes.find(route => route.route_id === trip?.route_id);

            const liveData = matchLiveData(tripUpdates, vehiclePositions, stopTime, trip?.trip_id || "");

            return {
                "Route Short Name": routeDetails?.route_short_name || "N/A",
                "Route Long Name": routeDetails?.route_long_name || "N/A",
                "Service ID": trip?.service_id || "N/A",
                "Heading Sign": trip?.trip_headsign || "N/A",
                "Scheduled Arrival Time": stopTime.arrival_time || stopTime.departure_time,
                "Live Arrival Time": liveData?.liveArrivalTime || "N/A",
                "Live Position": liveData?.livePosition || "N/A",
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
