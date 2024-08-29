import promptSync from 'prompt-sync';
import * as fs from "node:fs/promises";
import fetch from 'node-fetch';
import * as path from 'path';
import Dataframe from "./dataframe";

const prompt = promptSync();
const CACHE_DIR = './cached-data';
const CACHE_DURATION = 5 * 60 * 1000;

const loadJSON = async (url: string, cacheFile: string): Promise<any> => {
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

const matchRouteIds = (staticRouteId: string, realtimeRouteId: string): boolean => {
    const staticMainRoute = staticRouteId.split('-')[0];
    const realtimeMainRoute = realtimeRouteId.split('-')[0];
    return staticMainRoute === realtimeMainRoute;
};

const getRoute = (routesDF: Dataframe): string => {
    while (true) {
        const route = prompt("What Bus Route would you like to take? ");
        if (route && routesDF.filter(row => row.route_short_name === route).data.length > 0) {
            return route;
        }
        console.log("Please enter a valid bus route.");
    }
};

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

const matchLiveData = (
    tripUpdates: any[],
    vehiclePositions: any[],
    stopTime: any,
    routeId: string,
    userDateTime: Date
) => {
    if (!tripUpdates || !vehiclePositions) {
        console.log("No live data available");
        return { liveArrivalTime: 'N/A', livePosition: 'N/A' };
    }

    console.log(`Matching live data for route ${routeId}, stop ${stopTime.stop_id}`);

    const relevantTripUpdates = tripUpdates.filter(update => {
        if (!update.tripUpdate || !update.tripUpdate.trip || !update.tripUpdate.stopTimeUpdate) {
            return false;
        }

        const matched = matchRouteIds(routeId, update.tripUpdate.trip.routeId) &&
            update.tripUpdate.stopTimeUpdate.some((stu: any) => stu.stopId === stopTime.stop_id);

        if (matched) {
            console.log(`Found matching trip update for route ${routeId}`);
        }

        return matched;
    });

    if (relevantTripUpdates.length === 0) {
        console.log(`No relevant trip updates found for route ${routeId}`);
        return { liveArrivalTime: 'N/A', livePosition: 'N/A' };
    }

    const closestTripUpdate = relevantTripUpdates.reduce((closest, current) => {
        const closestTime = closest.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id)?.arrival?.time;
        const currentTime = current.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id)?.arrival?.time;

        if (!closestTime || !currentTime) return closest;

        const closestDate = new Date(parseInt(closestTime) * 1000);
        const currentDate = new Date(parseInt(currentTime) * 1000);
        const scheduledTime = new Date(`${userDateTime.toISOString().split('T')[0]}T${stopTime.arrival_time}`);

        return Math.abs(currentDate.getTime() - scheduledTime.getTime()) < Math.abs(closestDate.getTime() - scheduledTime.getTime()) ? current : closest;
    });

    console.log(`Closest trip update: ${JSON.stringify(closestTripUpdate)}`);

    const relevantVehiclePosition = vehiclePositions.find(position => {
        const positionTripId = position.vehicle?.trip?.tripId;
        const positionRouteId = position.vehicle?.trip?.routeId;

        console.log(`Checking vehicle position with tripId: ${positionTripId}, routeId: ${positionRouteId}`);

        return matchRouteIds(routeId, positionRouteId) && positionTripId === closestTripUpdate.tripUpdate.trip.tripId;
    });

    if (!relevantVehiclePosition) {
        console.log(`No matching vehicle position found for tripId: ${closestTripUpdate.tripUpdate.trip.tripId}`);
    } else {
        console.log(`Relevant vehicle position found: ${JSON.stringify(relevantVehiclePosition)}`);
    }

    const stopTimeUpdate = closestTripUpdate.tripUpdate.stopTimeUpdate.find((stu: any) => stu.stopId === stopTime.stop_id);

    let liveArrivalTime = 'N/A';
    if (stopTimeUpdate?.arrival?.time) {
        console.log(`Raw arrival time: ${stopTimeUpdate.arrival.time}`);
        const arrivalDate = new Date(parseInt(stopTimeUpdate.arrival.time) * 1000);
        // Convert to Australia/Brisbane timezone
        liveArrivalTime = arrivalDate.toLocaleTimeString('en-AU', {
            timeZone: 'Australia/Brisbane',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    return {
        liveArrivalTime: liveArrivalTime,
        livePosition: relevantVehiclePosition
            ? `${relevantVehiclePosition.vehicle.position.latitude}, ${relevantVehiclePosition.vehicle.position.longitude}`
            : 'N/A',
    };
};

const calculateTravelTime = (startTime: string, endTime: string): string => {
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

const getRouteStops = (
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

    // At this point, combinedStops should contain the full stop details including stop_name
    console.log("Final combined stops:", JSON.stringify(combinedStops, null, 2));

    return combinedStops;
};

const filterTripsForUpcomingDepartures = (
    stopTimesDF: Dataframe,
    tripsDF: Dataframe,
    routesDF: Dataframe,
    route: string,
    startStop: any,
    endStop: any,
    currentDateTime: Date,
    calendarDF: Dataframe,
    calendarDatesDF: Dataframe
) => {
    const tenMinutesLater = new Date(currentDateTime.getTime() + 10 * 60000);

    const isServiceRunning = (serviceId: string, date: Date): boolean => {
        const dayOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][date.getDay()];
        const dateString = date.toISOString().split('T')[0].replace(/-/g, '');

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

            return departureDateTime >= currentDateTime && departureDateTime <= tenMinutesLater;
        }
        return false;
    });

    return filteredStopTimes.data.map(startStopTime => {
        const trip = tripsDF.filter(t => t.trip_id === startStopTime.trip_id).data[0];
        const endStopTime = stopTimesDF.filter(st => st.trip_id === startStopTime.trip_id && st.stop_id === endStop.stop_id).data[0];
        return { startStopTime, endStopTime, routeId: trip ? trip.route_id : '' };
    });
};

const main = async () => {
    console.log("Welcome to the South East Queensland Route Planner!");

    const routesDF = await Dataframe.loadCSV('./static-data/routes.txt');
    const stopsDF = await Dataframe.loadCSV('./static-data/stops.txt');
    const stopTimesDF = await Dataframe.loadCSV('./static-data/stop_times.txt');
    const tripsDF = await Dataframe.loadCSV('./static-data/trips.txt');
    const calendarDF = await Dataframe.loadCSV('./static-data/calendar.txt');
    const calendarDatesDF = await Dataframe.loadCSV('./static-data/calendar_dates.txt');

    const tripUpdates = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/trip_updates.json', 'trip_updates.json')).entity;
    const vehiclePositions = (await loadJSON('http://127.0.0.1:5343/gtfs/seq/vehicle_positions.json', 'vehicle_positions.json')).entity;
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

            const liveData = matchLiveData(tripUpdates, vehiclePositions, startStopTime, routeId, currentDateTime);
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

        const replay = (prompt('Would you like to search again? (y/n) ') || "").toLowerCase();
        if (replay !== 'y' && replay !== 'yes') break;
    }

    console.log("Thanks for using the Route Tracker!");
};

main().catch(console.error);
