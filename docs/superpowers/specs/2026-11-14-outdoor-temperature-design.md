# Outdoor temperature and forecast

Add a per-apartment address selection and an outdoor daily mean temperature line to the existing climate chart. Extend only the temperature timeline by three calendar days after today, for heating planning. Today and future days are forecast, rendered dashed and explicitly labelled in tooltips and the accessible daily list. Historical outside values are model data, not apartment sensor measurements. Gaps stay gaps; zero and negative values are valid.

Use Photon/OpenStreetMap address search on explicit submission, via authenticated server endpoints with timeout, caching and rate limiting. Persist the selected label and coordinates per apartment. The default UI shows the saved location; Edit opens a draft with Save/Cancel, focus restoration, duplicate-save protection and visible errors. Switching apartments discards the draft; refreshes do not replace it.

Use Open-Meteo daily means including archived forecasts for the selected history period and today plus three future days, matching Europe/Warsaw dates. Load weather independently so a provider failure cannot hide indoor readings. Cache weather for 30 minutes per coordinates, date and range, coalesce in-flight requests, and invalidate by location identity. Attribute both providers and describe model history accurately.

## Approaches

Dashed forecast versus a faded line: choose dashed, because its meaning survives low contrast and can be explained in a legend. User requested either distinction and three upcoming days. Historical-only weather was considered in the prior conversation; the new request calls for a forecast as well. Use one weather provider across past and future rather than mixing incompatible sources. Public service defaults suit personal use; document their terms and allow the geocoder endpoint to be changed by environment.

No heater control, energy forecasts, map widget or indoor-temperature extrapolation.
