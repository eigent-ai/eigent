// src/utils/geo.tsx
import { yupNumber, yupObject, yupString } from "../schema-fields";
var geoInfoSchema = yupObject({
  ip: yupString().defined(),
  countryCode: yupString().nullable(),
  regionCode: yupString().nullable(),
  cityName: yupString().nullable(),
  latitude: yupNumber().nullable(),
  longitude: yupNumber().nullable(),
  tzIdentifier: yupString().nullable()
});
export {
  geoInfoSchema
};
//# sourceMappingURL=geo.js.map