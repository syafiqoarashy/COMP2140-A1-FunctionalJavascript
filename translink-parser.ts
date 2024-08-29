import promptSync from 'prompt-sync';
import * as fs from "node:fs/promises";
import fetch from 'node-fetch';
import * as path from 'path';
import Dataframe from "./dataframe";

const prompt = promptSync();
const CACHE_DIR = './cached-data';
const CACHE_DURATION = 5 * 60 * 1000;

/**
 * Loads JSON data from a URL or cache file.
 * @param {string} url - The URL to fetch data from.
 * @param {string} cacheFile - The cache file to save or load data from.
 * @returns {Promise<any>} The loaded JSON data.
 * @throws {Error} If data cannot be fetched or loaded from cache.
 */
export const loadJSON = async (url: string, cacheFile: string): Promise<any> => {
    const cachePath = path.join(CACHE_DIR, cacheFile);

    try {
        const stats = await fs.stat(cachePath);
        const now = Date.now();

        if (now - stats.mtimeMs < CACHE_DURATION) {
            return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        }
    } catch (err) {}

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch data from ${url}`);
        }
        const data = await response.json();

        await fs.writeFile(cachePath, JSON.stringify(data, null, 2), 'utf-8');
        return data;
    } catch (error) {
        console.warn(`Failed to fetch live data, falling back to cached data for ${cacheFile}`);
        try {
            return JSON.parse(await fs.readFile(cachePath, 'utf-8'));
        } catch (cacheError) {
            console.error(`No cached data available for ${cacheFile}`);
            return null;
        }
    }
};

/**
 * Matches route IDs by comparing their main components.
 * @param {string} staticRouteId - The route ID from static data.
 * @param {string} realtimeRouteId - The route ID from real-time data.
 * @returns {boolean} Whether the route IDs match.
 */
export const matchRouteIds = (staticRouteId: string, realtimeRouteId: string): boolean => {
    const staticMainRoute = staticRouteId.split('-')[0];
    const realtimeMainRoute = realtimeRouteId.split('-')[0];
    return staticMainRoute === realtimeMainRoute;
};

/**
 * Prompt the user to select a bus route and validate it.
 * @param {Dataframe} routesDF - The Dataframe containing route information.
 * @returns {string} - The selected valid bus route.
 */
const getRoute = (routesDF: Dataframe): string => {
    while (true) {
        const route = prompt("What Bus Route would you like to take? ");
        if (route && routesDF.filter(row => row.route_short_name === route).data.length > 0) {
            return route;
        }
        console.log("Please enter a valid bus route.");
    }
};

/**
 * Prompt the user to select start and end stops on the route.
 * @param {any[]} stops - The list of available stops on the route.
 * @returns {object|null} - The selected start and end stops.
 */
const getStartAndEndStops = (stops: any[]): { start: any, end: any } | null => {
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

/**
 * Prompt the user to enter a valid date in YYYY-MM-DD format.
 * @returns {string} - The validated date.
 */
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

/**
 * Prompt the user to enter a valid time in HH:mm format.
 * @returns {string} - The validated time.
 */
const getTime = (): string => {
    while (true) {
        const input = prompt("What time will you leave? (HH:mm) ");
        if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(input)) {
            return input;
        }
        console.log("Incorrect time format. Please use HH:mm.");
    }
};

/**
 * Match live data (trip updates and vehicle positions) with the selected stop time.
 * @param {any[]} tripUpdates - The array of trip updates.
 * @param {any[]} vehiclePositions - The array of vehicle positions.
 * @param {any} stopTime - The selected stop time.
 * @param {string} routeId - The route ID.
 * @param {string} tripId - The trip ID.
 */
export const matchLiveData = (
    tripUpdates: any[],
    vehiclePositions: any[],
    stopTime: any,
    routeId: string,
    tripId: string
) => {
    if (!tripUpdates || !vehiclePositions) {
        console.log("No live data available");
        return { liveArrivalTime: 'N/A', livePosition: 'N/A' };
    }

    console.log(`Matching live data for route ${routeId}, trip ${tripId}, stop ${stopTime.stop_id}`);

    const relevantTripUpdate = tripUpdates.find(update =>
        update.tripUpdate &&
        update.tripUpdate.trip &&
        update.tripUpdate.trip.tripId === tripId &&
        update.tripUpdate.trip.routeId === routeId
    );

    if (!relevantTripUpdate) {
        console.log(`No relevant trip update found for trip ${tripId} on route ${routeId}`);
        return { liveArrivalTime: 'N/A', livePosition: 'N/A' };
    }

    console.log(`Relevant trip update: ${JSON.stringify(relevantTripUpdate)}`);

    const stopTimeUpdate = relevantTripUpdate.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id);

    let liveArrivalTime = 'N/A';
    if (stopTimeUpdate?.arrival?.time || stopTimeUpdate?.departure?.time) {
        const time = stopTimeUpdate.arrival?.time || stopTimeUpdate.departure?.time;
        console.log(`Raw arrival/departure time: ${time}`);
        const arrivalDate = new Date(parseInt(time) * 1000);
        liveArrivalTime = arrivalDate.toLocaleTimeString('en-AU', {
            timeZone: 'Australia/Brisbane',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    const relevantVehiclePosition = vehiclePositions.find(position =>
        position.vehicle.trip.tripId === tripId &&
        position.vehicle.trip.routeId === routeId
    );

    if (!relevantVehiclePosition) {
        console.log(`No matching vehicle position found for trip ${tripId} on route ${routeId}`);
    } else {
        console.log(`Relevant vehicle position found: ${JSON.stringify(relevantVehiclePosition)}`);
    }

    return {
        liveArrivalTime: liveArrivalTime,
        livePosition: relevantVehiclePosition
            ? `${relevantVehiclePosition.vehicle.position.latitude}, ${relevantVehiclePosition.vehicle.position.longitude}`
            : 'N/A',
    };
};

/**
 * Calculates the travel time between two times.
 * @param {string} startTime - The start time in HH:mm format.
 * @param {string} endTime - The end time in HH:mm format.
 * @returns {string} The calculated travel time in a readable format.
 */
export const calculateTravelTime = (startTime: string, endTime: string): string => {
    const [startHours, startMinutes] = startTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    let diffMinutes = ((endHours * 60 + endMinutes) - (startHours * 60 + startMinutes) + 1440) % 1440;

    if (diffMinutes === 0) diffMinutes = 1440;

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours === 0) {
        return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    } else {
        return `${hours} hour${hours !== 1 ? 's' : ''} ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
};

/**
 * Get the stops for a specific route.
 * @param {string} route - The selected bus route.
 * @param {Dataframe} routesDF - The Dataframe containing route information.
 * @param {Dataframe} stopsDF - The Dataframe containing stop information.
 * @param {Dataframe} stopTimesDF - The Dataframe containing stop times information.
 * @param {Dataframe} tripsDF - The Dataframe containing trip information.
 * @returns {any[]} - The list of stops for the route.
 */
export const getRouteStops = (
    route: string,
    routesDF: Dataframe,
    stopsDF: Dataframe,
    stopTimesDF: Dataframe,
    tripsDF: Dataframe
): any[] => {
    const routeInfo = routesDF.filter(row => row.route_short_name === route).data[0];
    if (!routeInfo) {
        console.log("No route info found for route:", route);
        return [];
    }

    // Filter trips by route_id
    const routeTrips = tripsDF.filter(row => row.route_id === routeInfo.route_id);
    console.log(`Number of trips found for route: ${routeTrips.data.length}`);

    // Join stop_times with trips to get direction_id, then join with stops to get stop details
    const stopTimesWithTrips = stopTimesDF.join(routeTrips, 'trip_id');
    const allStopTimes = stopTimesWithTrips.join(stopsDF, 'stop_id')
        .select(['stop_id', 'stop_name', 'stop_sequence', 'direction_id']);

    console.log(`Total stop times: ${allStopTimes.data.length}`);
    if (allStopTimes.data.length > 0) {
        console.log("Sample stop time record:", JSON.stringify(allStopTimes.data[0]));
    }

    // Sort by direction_id first, then by stop_sequence within each direction
    const sortedStopTimes = new Dataframe(allStopTimes.data).sort('direction_id').sort('stop_sequence');

    // Get unique stops for each direction with full details
    const outboundStops = sortedStopTimes
        .filter((row: { direction_id: string; }) => row.direction_id === '0')
        .distinct('stop_id')
        .data;

    const inboundStops = sortedStopTimes
        .filter((row: { direction_id: string; }) => row.direction_id === '1')
        .distinct('stop_id')
        .data

    console.log(`Outbound stops: ${outboundStops.length}, Inbound stops: ${inboundStops.length}`);

    // Combine outbound and inbound stops
    const combinedStops = [...outboundStops, ...inboundStops];

    console.log(`Total combined stops: ${combinedStops.length}`);

    // Remove duplicates at the start/end if it's a loop
    if (combinedStops.length > 0 && combinedStops[0].stop_id === combinedStops[combinedStops.length - 1].stop_id) {
        combinedStops.pop();
    }

    console.log("Final combined stops:", JSON.stringify(combinedStops, null, 2));

    return combinedStops;
};

/**
 * Filters trips for upcoming departures within the next 10 minutes.
 * @param {Dataframe} stopTimesDF - The Dataframe containing stop times information.
 * @param {Dataframe} tripsDF - The Dataframe containing trip information.
 * @param {Dataframe} routesDF - The Dataframe containing route information.
 * @param {string} route - The selected bus route.
 * @param {any} startStop - The selected start stop.
 * @param {any} endStop - The selected end stop.
 * @param {Date} currentDateTime - The current date and time.
 * @param {Dataframe} calendarDF - The Dataframe containing calendar information.
 * @param {Dataframe} calendarDatesDF - The Dataframe containing calendar dates information.
 * @returns {any[]} The list of upcoming trips.
 */
export const filterTripsForUpcomingDepartures = (
    stopTimesDF: Dataframe,
    tripsDF: Dataframe,
    routesDF: Dataframe,
    route: string,
    startStop: any,
    endStop: any,
    currentDateTime: Date,
    calendarDF: Dataframe,
    calendarDatesDF: Dataframe
): any[] => {
    const tenMinutesLater = new Date(currentDateTime.getTime() + 10 * 60000);

    console.log('Current DateTime:', currentDateTime);
    console.log('Ten Minutes Later:', tenMinutesLater);

    const isServiceRunning = (serviceId: string, date: Date): boolean => {
        const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
        const dateString = date.toISOString().split('T')[0].replace(/-/g, '');

        console.log('Checking service:', serviceId, 'for date:', dateString, 'day:', dayOfWeek);

        const exceptionRow = calendarDatesDF
            .filter(row => row.service_id === serviceId && row.date === dateString)
            .data[0];

        if (exceptionRow) {
            return exceptionRow.exception_type === '1';
        }

        const serviceCalendar = calendarDF.filter(row => row.service_id === serviceId).data[0];
        if (!serviceCalendar) return false;

        const startDate = new Date(serviceCalendar.start_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));
        const endDate = new Date(serviceCalendar.end_date.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3'));

        console.log('Service calendar:', serviceCalendar);
        console.log('Service running:', date >= startDate && date <= endDate && serviceCalendar[dayOfWeek] === '1');

        return date >= startDate && date <= endDate && serviceCalendar[dayOfWeek] === '1';
    };

    const filteredStopTimes = stopTimesDF.filter(row => {
        if (row.stop_id === startStop.stop_id) {
            const trip = tripsDF.filter(t => t.trip_id === row.trip_id).data[0];
            if (!trip || !isServiceRunning(trip.service_id, currentDateTime)) {
                return false;
            }
            const routeInfo = routesDF.filter(r => r.route_id === trip.route_id).data[0];
            if (routeInfo.route_short_name !== route) {
                return false;
            }
            const departureTime = row.departure_time || row.arrival_time;
            const [hours, minutes] = departureTime.split(':').map(Number);
            const departureDateTime = new Date(currentDateTime);
            departureDateTime.setHours(hours, minutes, 0, 0);

            console.log('Departure Time:', departureTime, 'Departure DateTime:', departureDateTime);

            return departureDateTime >= currentDateTime && departureDateTime <= tenMinutesLater;
        }
        return false;
    });

    console.log('Filtered Stop Times:', filteredStopTimes.data);

    return filteredStopTimes.data.map(startStopTime => {
        const trip = tripsDF.filter(t => t.trip_id === startStopTime.trip_id).data[0];
        const endStopTime = stopTimesDF.filter(st => st.trip_id === startStopTime.trip_id && st.stop_id === endStop.stop_id).data[0];
        return { startStopTime, endStopTime, routeId: trip ? trip.route_id : '' };
    });
};

/**
 * Main function to run the route tracker application.
 */
const main = async () => {
    console.log("Welcome to the South East Queensland Route Planner!");

    const routesDF = await Dataframe.loadCSV('./static-data/routes.txt');
    const stopsDF = await Dataframe.loadCSV('./static-data/stops.txt');
    const stopTimesDF = await Dataframe.loadCSV('./static-data/stop_times.txt');
    const tripsDF = await Dataframe.loadCSV('./static-data/trips.txt');
    const calendarDF = await Dataframe.loadCSV('./static-data/calendar.txt');
    const calendarDatesDF = await Dataframe.loadCSV('./static-data/calendar_dates.txt');

    const tripUpdates = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/trip_updates.json', 'trip_updates.json')).entity as any[];
    const vehiclePositions = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/vehicle_positions.json', 'vehicle_positions.json')).entity as any[];
    const alerts = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/alerts.json', 'alerts.json')).entity;

    while (true) {
        const route = getRoute(routesDF);
        const stopsForRoute = getRouteStops(route, routesDF, stopsDF, stopTimesDF, tripsDF);

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

        const upcomingStopTimes = filterTripsForUpcomingDepartures(
            stopTimesDF,
            tripsDF,
            routesDF,
            route,
            startAndEndStops.start,
            startAndEndStops.end,
            currentDateTime,
            calendarDF,
            calendarDatesDF
        );

        const result = upcomingStopTimes.map(({ startStopTime, endStopTime, routeId }) => {
            const trip = tripsDF.filter(row => row.trip_id === startStopTime.trip_id).data[0];
            const routeDetails = routesDF.filter(row => row.route_id === routeId).data[0];

            const liveData = matchLiveData(tripUpdates, vehiclePositions, startStopTime, routeId, trip.trip_id);
            const startTime = startStopTime.arrival_time || startStopTime.departure_time;
            const endTime = endStopTime ? (endStopTime.arrival_time || endStopTime.departure_time) : null;

            const estimatedTravelTime = endTime ? calculateTravelTime(startTime, endTime) : "N/A";

            const scheduledArrivalTime = new Date(`${date}T${startTime}+10:00`).toLocaleTimeString('en-AU', {
                timeZone: 'Australia/Brisbane',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });

            return {
                "Route Short Name": routeDetails?.route_short_name || "N/A",
                "Route Long Name": routeDetails?.route_long_name || "N/A",
                "Service ID": trip?.service_id || "N/A",
                "Trip ID": trip?.trip_id || "N/A",
                "Heading Sign": trip?.trip_headsign || "N/A",
                "Scheduled Arrival Time": scheduledArrivalTime,
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

        const replay = () => {
            while (true) {
                const input = prompt('Would you like to search again? (y/n) ').toLowerCase();
                if (input === 'y' || input === 'n') {
                    return input === 'y';
                }
                console.log("Please enter 'y' or 'n'.");
            }
        };
        if (!replay()) break;
    }

    console.log("Thanks for using the Route Tracker!");
};

main().catch(console.error);
