import * as yup from 'yup';

declare const geoInfoSchema: yup.ObjectSchema<{
    ip: string;
    countryCode: string | null | undefined;
    regionCode: string | null | undefined;
    cityName: string | null | undefined;
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    tzIdentifier: string | null | undefined;
}, yup.AnyObject, {
    ip: undefined;
    countryCode: undefined;
    regionCode: undefined;
    cityName: undefined;
    latitude: undefined;
    longitude: undefined;
    tzIdentifier: undefined;
}, "">;
type GeoInfo = yup.InferType<typeof geoInfoSchema>;

export { type GeoInfo, geoInfoSchema };
