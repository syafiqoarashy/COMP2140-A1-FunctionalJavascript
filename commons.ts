export interface Route {
    route_id: string;
    route_short_name: string;
    route_long_name: string;
}

export interface Stop {
    stop_id: string;
    stop_name: string;
    stop_lat: number;
    stop_lon: number;
}

export interface StopTime {
    trip_id: string;
    arrival_time: string;
    departure_time: string;
    stop_id: string;
    stop_sequence: number;
}

export interface Trip {
    route_id: string;
    service_id: string;
    trip_id: string;
    trip_headsign: string;
    direction_id: number;
    block_id: string;
    shape_id: string;
}

export interface Calendar {
    service_id: string;
    monday: string;
    tuesday: string;
    wednesday: string;
    thursday: string;
    friday: string;
    saturday: string;
    sunday: string;
    start_date: string;
    end_date: string;
}

export interface CalendarDate {
    service_id: string;
    date: string;
    exception_type: number;
}
