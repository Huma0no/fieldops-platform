System Design Document

Field Ops + Dispatch — HVAC Startup Platform

Version: 1.1

Date: 2026-06-14

Authors: Christian Huerta + Claude (planning session)

Status: Design baseline — pre-development


1. Purpose

This document is the source of truth for the platform. It defines what the system is, who it serves, what problems it solves, what entities it manages, and how work flows end to end.

This is not a development plan. It is the map that any developer, AI instance, or collaborator must read before touching code.


2. Business Context

Christian Huerta is an independent HVAC contractor specializing in residential new construction startups in the Houston, TX area.

Chain of work

Builders (Constructoras)
    ↓ hire
Big-AC Company (La Compañía)
    ↓ subcontracts
Christian Huerta (The Contractor)
    ↓ coordinates
Technician collaborators

Operating model


The Company sends a daily PDF by email with the day's route — a list of houses where an HVAC startup must be performed.
Christian (as Dispatcher) processes that PDF and distributes the calls to his technicians.
Technicians execute the work in the field and report what they did.
Christian consolidates and reports back to The Company.
The Company pays Christian by check the Friday following the worked period.
Christian pays his technicians within 48 business hours of receiving the check.


Financial model


Technician collaborators receive 80% of what they generated in the period.
Christian retains 20% as operating margin.
Christian's only operating expenses are gasoline, personal vehicle maintenance, and personal tools.
The Company provides all equipment, accessories, and consumables — Christian does not purchase or invest in material.
Houston, TX taxes apply to period income.


Scale — current and projected


Today: Christian is simultaneously Dispatcher and sole Technician.
Near future: A dedicated Dispatcher + multiple technician collaborators.
Long-term goal: A sellable platform for other HVAC subcontractors.



3. Actors

3.1 The Company (Big-AC Company)


Origin of all service calls.
Provides all equipment, accessories, and consumables for operations.
Sends a daily PDF with the route.
Receives completion reports (text + photos as evidence).
Does not interact directly with the system — it is the input source and output destination.
Pending: Define the official report format The Company requires. The order number from the PDF must be included in the report back to them.


3.2 The Dispatcher


Receives the PDF from The Company.
Processes calls in Dispatch (with AI assistance for field extraction).
Publishes calls to the Lobby or assigns them directly to technicians.
Monitors the status of all active calls.
Manages inventory assigned to each technician.
Generates payment, restock, and period reports.
Receives transfer notifications — informational, no action required.
Access: Dispatch (web, desktop).


3.3 The Technician


Sees only their assigned calls.
Executes work in the field.
Uses the PWA to manage their jobs, record completions, and access technical tools.
Generates the Completion Report at the end of the day.
Can transfer a call directly to another technician without Dispatcher authorization.
Access: Field Ops PWA (mobile, offline-capable).


3.4 The Builder


Owner of the construction site where work is performed.
Does not interact directly with the system.
Appears as an attribute of each call (Chesmar, Lennar, Highland, William David, etc.).



4. System Entities

4.1 Address

The central and permanent entity of the system. An address uniquely identifies a property.

Attributes:


Full address (street + number)
City, state, ZIP
Subdivision
Builder
Order number (from The Company's PDF)
Visit history (collection of Visits ordered by date)


Rules:


An address can have multiple visits on different dates.
Multiple systems at the same address do not create multiple entities — they are handled within the same Visit.
History is cumulative and never deleted.


4.2 Visit

A visit is a service call to an address on a specific date, executed by a specific technician. What is currently called a "job" (before completion) and a "completion" (after) are two states of the same entity.

Identity attributes:


Unique ID
Address (reference)
Date
Assigned technician
Order number (inherited from PDF)
Scheduled time
Builder contact (name + phone)
Contact channel (email, supply pro, etc.)


Context attributes (from PDF):


Work type (AC Startup, AC & Heating Startup, Finish Start Up, etc.)
Company notes (free-text from PDF — IMPORTANT NOTES)
System 1: indoor model, outdoor model
System 2+: additional models (multi-system flag)
Pre-specified thermostat (type + quantity)
Pre-identified accessories


Execution attributes (from technician in field):


Services performed (see section 5)
Thermostat installed (type + quantity)
Accessories installed
Fixes performed
Weigh-in data per system (see section 4.3)
Technician notes
Photos (weigh-in scale, fan speed, site evidence)
Total price


States:

In Lobby → Assigned → In Progress → Completed
                                  → Temporarily
                                  → Cancelled
                                  → Transferred → Reassigned (never returns to Lobby)

Rules:


Cancel means zero work performed. Price = $0. No accessories or fixes can be charged on a Cancel. Any accessory charged on a Cancel is a UI bug the system must prevent.
Temporarily means the system was turned on provisionally during the visit and turned off upon leaving.
Any type of visit can have child visits on future dates.
The complete cycle of an address is not guaranteed with the same technician. The Company may reassign.


4.3 Transfer

Reassignment flow between technicians without Dispatcher intervention.

Flow:


Tech1 and Tech2 agree on the transfer between themselves.
Tech1 initiates the transfer in their PWA, selects Tech2, and documents a brief reason.
Tech2 receives the request in their PWA and accepts.
Upon acceptance, Tech2's PWA automatically notifies Dispatch.
Dispatch reassigns the visit to Tech2 automatically.
Dispatcher receives an informational notification — no action required.


Rules:


The visit never returns to the Lobby during a transfer.
The transfer reason is recorded in the visit history.
Dispatch is informed, not an approver.


4.4 Weigh-in Data

Refrigerant charge data per system. Applies when the technician adds refrigerant.

Fields per system:


Lineset length (ft)
Line configuration (factory preset)
Factory charge (oz)
Approximate adjustment (oz) — calculated
Adjusted oz — recorded
Fan speed CFM
Liquid line temperature (°F)
Suction line temperature (°F)
Condenser saturation temperature (°F)
Measured subcooling (°F)
OEM subcooling goal (°F)
Subcooling deviation (°F)


4.5 Technician

Attributes:


Unique ID
Name
Personal configuration (theme, AI provider, API keys)
Customized prices (overrides on defaults)
Current assigned inventory
History of completed visits


Rules:


A technician sees only their assigned visits.
Financial data of other technicians is not visible between them.
The technician does not exist as a visible entity to The Company — Christian is the contractor.


4.6 Technician Inventory

Record of accessories and consumables assigned to each technician for field operations.

Cycle:


Assignment — Dispatch assigns a stock of accessories to each technician at the start of the period or when replenishment is needed. The technician physically picks up at the delivery point.
Automatic consumption — Each completion report automatically deducts from the technician's inventory the accessories installed. The technician does not report consumption separately.
Restock — At the close of the period, the system calculates the current balance (assigned − consumed) and generates a restock recommendation based on actual consumption + projected upcoming work.


Rules:


All technicians handle the same accessory catalog — no specialization per technician.
The Company provides all material — the system tracks consumption, not purchases.
The restock report is delivered to The Company for inventory replenishment.


4.7 Pay Period

Groups all completed visits from Monday to Friday for settlement.

Attributes:


Date range (Monday to Friday)
Technicians included
Completed visits per technician
Gross subtotal per technician
Retained commission (20%)
Net per technician (80%)
Period gross total
Applicable taxes (Houston, TX — rate pending confirmation)
Status (open / closed / paid)


Payment cycle:


The Company pays Christian by check the Friday following the worked period.
Christian pays technician collaborators within 48 business hours of receiving the check.


4.8 Restock Report

Consumption report of accessories per period, generated for The Company.

Attributes:


Period
List of accessories with quantity consumed (total and per technician)
Status per accessory (pending / restocked)



5. Services and Pricing Logic

The complete logic for services, prices, modifiers, accessories, and fixes is implemented in the current PWA and is the source of truth for those rules. This document does not duplicate it — it references it.

5.1 Base services

AC · Heat · AC & Heat · Prestart System · Finish · Temporarily · Cancel · Drive Run

5.2 Critical Cancel rule

Cancel = zero work performed. Price $0. Invalidates charging any accessory or fix. Any accessory charged on a Cancel is a UI error the system must prevent.

5.3 Accessories and Fixes

Catalog defined in the PWA (~20 accessories, ~12 fixes). It is the single source — Dispatch consumes it, does not duplicate it.


6. End-to-End Workflow

1. PDF arrives by email from The Company
        ↓
2. Dispatcher uploads PDF to Dispatch
   AI extracts fields → fields remain editable → Dispatcher confirms → Visits created
        ↓
3. Visits published to the Lobby
   (visible to all technicians with tags: urgent · A2L · 2 systems · builder)
        ↓
4. Technician takes visit from Lobby  ←→  Dispatcher assigns directly
   Visit disappears from Lobby
        ↓
5. Technician in field — PWA
   Job card: full visit context
   Workspace: record of what was done
   Tools: LV diagrams, troubleshooting, AI chat, charge calculator
        ↓
   [Exception: Tech1 transfers to Tech2 → Tech2 accepts → Dispatch notified automatically]
        ↓
6. Technician marks visit as completed
   Automatic send to Dispatch when connected
   Button always available: Download Report (JSON or defined format) — manual fallback
        ↓
7. Dispatch receives completions
   History: permanent record per address
   Inventory: consumption automatically deducted per technician
   Restock: accumulated consumed accessories
   Pay period: totals per technician updated
        ↓
8. Dispatcher generates report to The Company
   Includes original order number + photos as evidence
   (official format pending definition with The Company)
        ↓
9. Period close (Friday)
   Payment report: gross · 20% commission · net per technician · Houston TX taxes
   Restock report generated and delivered to The Company
   The Company issues check → Christian pays technicians within 48 business hours


7. System Surfaces

7.1 Field Ops (PWA)

Field tool. Mobile-first, offline-capable. Each technician sees only their assigned visits.

Main views:


Lobby — available unassigned visits (to claim)
My Calls — visits assigned to the active technician
Workspace — execution of the active job
Reports — day's completions, share and export
LV — low-voltage wiring diagrams


Field tools:


Equipment catalog with technical specs (refrigerant, factory charge, subcooling target, CFM range, ESP)
Refrigerant charge calculator
Contextual troubleshooting engine (9 symptoms, PT tables R-32/R-454B/R-410A)
Contextual AI chat with active job data
LV diagram viewer (zoomable, offline-cached)
Photos: weigh-in scale, fan speed, site evidence


Communication:


Internal chat: Technician ↔ Dispatcher and Technician ↔ Technician
Notifications: assignments, received transfers, messages


UX:


All modals close when clicking outside the modal.


7.2 Dispatch

Administrative panel. Desktop-first. Dispatcher access.

Modules:


PDF Intake — upload + AI extraction + editable fields + confirmation + visit creation
Lobby — unassigned visits with priority tags, direct assignment available
Assigned — visits per technician with real-time status
History — permanent record of all completed visits, grouped by address
Inventory — stock assigned per technician, accumulated consumption, low-level alerts
Restock — consumption report per period, replenishment status, delivery to The Company
Pay Period — gross totals · commissions · net per technician · taxes
Reports — formal report generation for The Company
Chat — internal communication Dispatcher ↔ Technicians and Technicians ↔ Technicians
Notifications — notification center with direct navigation to relevant area


UX:


All modals close when clicking outside the modal.



8. Technical Architecture — Principles

8.1 Offline-first

The PWA works completely without connection. When connected, it syncs in real time. The downloadable JSON is the network fallback, not the main flow.

8.2 Shared server

A single backend (Node/Express + SQLite) serves both Dispatch and the PWA. It is the source of truth for all persistent entities.

8.3 Catalogs as single source

Equipment, accessory, fix, and service catalogs live on the server. No app duplicates them locally — they consume them via API and cache them for offline use.

8.4 Real-time + fallback

Communication between PWA and Dispatch is real-time when connected. The exportable JSON persists as a downloadable backup, especially useful in construction zones without signal.

8.5 Multi-technician by design

All entities include technicianId. The system never assumes a single user.

8.6 Financial privacy

Payment and commission data is visible only to the Dispatcher. Technicians see only their own totals.


9. Communication with The Company

9.1 Input

PDF by email → processed by Dispatcher in Dispatch with AI assistance.

9.2 Output


Completion report per visit (text + photos as evidence).
Original order number from PDF included in the report back.
Pending: Define the official format required by The Company.


9.3 Restock

Accessory consumption report per period, delivered to The Company for inventory replenishment.


10. External Definition Pending

FeatureDependencyOfficial completion report formatConversation with The CompanyRestock report cycle and delivery channelConversation with The CompanyHouston TX tax rateAccounting consultationTechnician payment frequency and channelInternal operational decision


11. What Exists Today and Its Relation to This Design

The existing code in Huma0no/ACstartup (branch build/desde-cero) implements a functional version of this system with the following differences from the ideal design:


Data transfer between Dispatch and PWA is manual (JSON export/import) instead of real-time.
Catalogs are duplicated between src/data.js and dispatch.html instead of living on the server as a single source.
No Lobby exists — calls are assigned directly via JSON.
No multi-technician support — the system assumes a single user.
Visit lineage exists as addressHistory in free text, not as a structured entity.
No internal chat or notifications.
Inventory module does not exist — restock is manual.
Pay Period module is partially implemented.


The existing code is valid as a partial implementation of this design. The development path is to evolve toward this model — except where the current architecture prevents growth.


Document generated in planning session — 2026-06-14

Version 1.1 — incorporates post-generation review comments

Next step: Formal data model and development plan with phases, dependencies, and acceptance criteria
