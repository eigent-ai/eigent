"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/utils/geo.tsx
var geo_exports = {};
__export(geo_exports, {
  geoInfoSchema: () => geoInfoSchema
});
module.exports = __toCommonJS(geo_exports);
var import_schema_fields = require("../schema-fields");
var geoInfoSchema = (0, import_schema_fields.yupObject)({
  ip: (0, import_schema_fields.yupString)().defined(),
  countryCode: (0, import_schema_fields.yupString)().nullable(),
  regionCode: (0, import_schema_fields.yupString)().nullable(),
  cityName: (0, import_schema_fields.yupString)().nullable(),
  latitude: (0, import_schema_fields.yupNumber)().nullable(),
  longitude: (0, import_schema_fields.yupNumber)().nullable(),
  tzIdentifier: (0, import_schema_fields.yupString)().nullable()
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  geoInfoSchema
});
//# sourceMappingURL=geo.js.map