---
name: route-optimization-api-web-api
description: Use this skill when generating and optimizing multi-stop delivery plans, fleet routes, and logistics schedules using the Google Maps Platform Route Optimization API via HTTP REST requests. This skill helps configure shipment pickup and delivery time windows, vehicle load limits, cost models, parking buffers, live traffic consideration, and routing constraints like avoiding U-turns, as well as retrieving route polylines, navigation tokens, stop durations, and batch optimization results written to Google Cloud Storage.
license: Apache-2.0
metadata:
  version: 1.0.55
---

> [!IMPORTANT] **Core Dependency:** This skill requires active context from
> [google-maps-platform/SKILL.md](https://www.gstatic.com/googlemapsplatform-agent-skills/google-maps-platform/SKILL.md).

### Overview

The Route Optimization API is a Google Maps Platform web service accessed via
HTTP REST endpoints that computes optimal multi-stop delivery plans for vehicle
fleets. Use this skill to construct optimization requests that balance complex
logistics constraints—such as vehicle availability, load capacities, shipment
time windows, cost parameters, and live traffic—and to parse response payloads
containing detailed stop schedules, travel durations, encoded route polylines,
navigation tokens, and aggregate fleet metrics, or to manage asynchronous batch
processing via Google Cloud Storage.

## Primary Orchestration Integration Workflow

Follow this multi-phase sequential integration checklist to compose features
robustly. For each phase, read the referenced capability sub-workflow file and
satisfy its *Evidence Checkpoint* before advancing.

### Phase 1: Core Initialization & Base Setup (Primary)

-   [ ] **Step 1.1: Returns a multi-stop delivery plan optimized based on
    specified routing, cost, shipment, and vehicle constraints via an HTTP REST
    request.** Read
    [references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md).
    *Trigger Condition*: Use when initializing or executing a synchronous
    multi-stop delivery route optimization request. *Evidence Checkpoint*: HTTP
    200 OK response containing the optimized `routes` array in the JSON payload.

### Phase 2: Feature Layer & Custom Enrichment (Supplemental)

#### Feature Module: Routes (Optional - Use-Case Dependent)

-   [ ] **Retrieves the scheduled start and end times for each stop in an
    optimized delivery plan.** Read
    [references/return-start-and-end-times-each-stop-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-start-and-end-times-each-stop-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user needs arrival, departure, or service
    time windows for individual stops in the optimized route response. *Evidence
    Checkpoint*: Presence of `startTime` and `detour` or visit duration fields
    within each stop object in the `visits` array of the JSON response.
-   [ ] **Returns the travel, delay, break, and wait durations between stops in
    an optimized delivery plan.** Read
    [references/return-travel-delay-break-and-wait-durations-between-each-stop-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-travel-delay-break-and-wait-durations-between-each-stop-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants to analyze transition
    durations, driver wait times, breaks, or traffic delays between stops.
    *Evidence Checkpoint*: Presence of `travelDuration`, `waitDuration`,
    `breakDuration`, and `delayDuration` fields in the `transitions` array of
    the JSON response.
-   [ ] **Returns vehicle load metrics at each stop along an optimized delivery
    plan.** Read
    [references/return-vehicle-load-information-each-stop-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-vehicle-load-information-each-stop-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user needs to track vehicle capacity
    utilization or cargo load changes after each pickup or delivery stop.
    *Evidence Checkpoint*: Presence of `loadDemands` or `vehicleLoads` objects
    within the `visits` or `transitions` arrays in the JSON response.
-   [ ] **Returns the calculated cost breakdown for each shipment/route in an
    optimized delivery plan.** Read
    [references/return-cost-information-each-shipment-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-cost-information-each-shipment-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user requests granular cost metrics
    associated with individual routes or shipments in the optimization output.
    *Evidence Checkpoint*: Presence of `routeCosts` and `routeTotalCost` fields
    in the `routes` objects of the JSON response.
-   [ ] **Requests and returns an encoded polyline representing the geographic
    path between stops on an optimized delivery plan.** Read
    [references/return-encoded-polyline-route-between-each-stop-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-encoded-polyline-route-between-each-stop-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants to render the optimized vehicle
    routes on a map or needs the route geometry between stops. *Evidence
    Checkpoint*: Request sets `populatePolylines` or
    `populateTransitionPolylines` to true, and the JSON response includes
    `routePolyline` with `points`.
-   [ ] **Returns a navigation route token for the path between stops on an
    optimized delivery plan.** Read
    [references/return-navigation-route-token-route-between-each-stop-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-navigation-route-token-route-between-each-stop-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user intends to pass the optimized route
    to the Google Navigation SDK for turn-by-turn driver navigation. *Evidence
    Checkpoint*: Presence of `routeToken` within the `transitions` array in the
    JSON response.
-   [ ] **Returns aggregate shipment, vehicle, and cost summary metrics for the
    entire optimized delivery plan.** Read
    [references/return-aggregate-shipment-vehicle-and-cost-metrics-optimized-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/return-aggregate-shipment-vehicle-and-cost-metrics-optimized-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants high-level summary statistics,
    total costs, total distances, or skipped shipment counts across the entire
    fleet. *Evidence Checkpoint*: Presence of the top-level `metrics` object and
    `aggregatedMetrics` within the JSON response.
-   [ ] **Configures the global start and end time window (`globalStartTime` and
    `globalEndTime`) for a multi-stop delivery plan.** Read
    [references/specify-start-and-end-time-window-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-start-and-end-time-window-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user needs to bound the overall planning
    horizon or operating hours for the entire optimization model. *Evidence
    Checkpoint*: Request payload includes valid RFC 3339 timestamps for
    `globalStartTime` and `globalEndTime` inside the `model` object.
-   [ ] **Specifies start and end locations and operating time windows for
    individual vehicles in a delivery plan.** Read
    [references/specify-start-and-end-time-availability-and-locations-each-vehicle-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-start-and-end-time-availability-and-locations-each-vehicle-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when defining depot locations, driver shift hours,
    or vehicle availability windows. *Evidence Checkpoint*: Vehicle objects in
    the request payload define `startLocation`, `endLocation`,
    `startTimeWindows`, and `endTimeWindows`.
-   [ ] **Configures time-based cost parameters (such as cost per hour or cost
    per traveled hour) for each vehicle.** Read
    [references/specify-vehicle-time-costs-each-vehicle-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-vehicle-time-costs-each-vehicle-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants to model driver wages, hourly
    vehicle operating costs, or time-based cost penalties. *Evidence
    Checkpoint*: Vehicle objects in the request payload contain `costPerHour` or
    `costPerTraveledHour` fields.
-   [ ] **Specifies comprehensive cost model parameters (fixed costs, distance
    costs, penalty costs) for a multi-stop delivery plan.** Read
    [references/specify-cost-model-parameters-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-cost-model-parameters-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when tuning the optimization objective using fixed
    vehicle costs, per-kilometer costs, or skipped shipment penalty costs.
    *Evidence Checkpoint*: Request payload configures `fixedCost`,
    `costPerKilometer`, or shipment `penaltyCost` within the `model` definition.
-   [ ] **Specifies pickup and delivery time windows and service durations for
    each shipment.** Read
    [references/specify-pickup-and-delivery-time-constraints-each-shipment-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-pickup-and-delivery-time-constraints-each-shipment-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when shipments have strict customer delivery
    appointments, store pickup hours, or required dwell/handling durations.
    *Evidence Checkpoint*: Shipment objects in the request payload include
    `pickups` and/or `deliveries` with `timeWindows` and `duration` fields.
-   [ ] **Restricts or assigns specific shipments to designated vehicles in a
    multi-stop delivery plan.** Read
    [references/specify-vehicle-assignments-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-vehicle-assignments-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when certain shipments require specific vehicle
    capabilities or must be carried only by allowed vehicles. *Evidence
    Checkpoint*: Shipment objects in the request payload contain the
    `allowedVehicleIndices` array.
-   [ ] **Defines capacity load limits (such as weight, volume, or package
    count) for each vehicle and load demands for shipments.** Read
    [references/specify-load-limits-each-vehicle-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-load-limits-each-vehicle-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when vehicles have physical capacity constraints
    (e.g., max weight or volume) that must not be exceeded. *Evidence
    Checkpoint*: Vehicle objects define `loadLimits` and shipment objects define
    matching `loadDemands` in the request payload.
-   [ ] **Configures whether live or traffic-aware routing information is used
    when calculating travel durations and paths.** Read
    [references/specify-whether-consider-live-traffic-information-multi-stop-delivery-plan.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/specify-whether-consider-live-traffic-information-multi-stop-delivery-plan.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants routes to account for real-time
    or historical traffic conditions via `searchMode` or `trafficModel`.
    *Evidence Checkpoint*: Request payload specifies traffic configuration such
    as `considerRoadTraffic` in the request.
-   [ ] **Executes an asynchronous batch route optimization request using
    Long-Running Operations (LRO) with input/output stored in Google Cloud
    Storage.** Read
    [references/batch-process-multi-stop-delivery-plan-optimization-request-and-write-response-google-cloud-storage.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/batch-process-multi-stop-delivery-plan-optimization-request-and-write-response-google-cloud-storage.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when solving large-scale optimization problems
    asynchronously or reading/writing optimization payloads directly to Google
    Cloud Storage (`batchOptimizeTours`). *Evidence Checkpoint*: POST request to
    `:batchOptimizeTours` returns an LRO `operation` name, and completed results
    are written to the specified GCS output URI.
-   [ ] **Models parking locations and reserves time for parking and walking
    between the vehicle and delivery locations.** Read
    [references/reserve-time-parking-before-making-deliveries.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/reserve-time-parking-before-making-deliveries.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when drivers must park at a designated spot and
    walk to complete one or more nearby deliveries. *Evidence Checkpoint*:
    Request payload configures parking constraints or transition attributes to
    account for parking buffer time.
-   [ ] **Configures the optimization model to group and prioritize nearby
    visits so they are performed consecutively.** Read
    [references/prioritize-nearby-visits-be-made-back-back.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/prioritize-nearby-visits-be-made-back-back.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants to cluster closely located
    stops together and avoid split or fragmented visits to the same area.
    *Evidence Checkpoint*: Request payload includes transition attributes or
    grouping penalties to incentivize back-to-back visits for nearby stops.
-   [ ] **Configures routing modifiers or stop waypoints to prevent vehicles
    from making U-turns along a multi-stop route.** Read
    [references/avoid-making-u-turn-multi-stop-vehicle-route.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/avoid-making-u-turn-multi-stop-vehicle-route.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when commercial or large delivery vehicles must
    avoid unsafe or illegal U-turns at stops or along routes. *Evidence
    Checkpoint*: Waypoints or `routeModifiers` in the request payload set
    `sideOfRoad` or U-turn avoidance flags.
-   [ ] **Configures pre-defined optimization objectives to guide the solver
    without manually tuning complex cost weights.** Read
    [references/optimize-pre-defined-objectives.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/optimize-pre-defined-objectives.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md"]` \
    *Trigger Condition*: Use when the user wants to optimize for standard
    business goals using pre-defined objective settings. *Evidence Checkpoint*:
    Request payload includes the configured objective parameters within the
    optimization model.
-   [ ] **Applies load-dependent costs or constraints so that heavier shipments
    are prioritized for earlier delivery in the route.** Read
    [references/deliver-heavier-shipments-first.md](https://www.gstatic.com/googlemapsplatform-agent-skills/route-optimization-api-web-api/references/deliver-heavier-shipments-first.md).
    *Dependencies*:
    `["references/return-multi-stop-delivery-plan-optimized-based-specified-routing-cost-shipment-and-vehicle-constrai.md",
    "references/specify-load-limits-each-vehicle-multi-stop-delivery-plan.md"]` \
    *Trigger Condition*: Use when the user wants vehicles to offload heavy cargo
    early in the route to reduce fuel consumption or ease access. *Evidence
    Checkpoint*: Request payload defines load cost parameters (such as
    `costPerKilometer` or `costPerTraveledHour` on `loadLimits`) to penalize
    carrying heavy loads over longer distances or durations.
