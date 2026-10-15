// Warranty wording a shop can attach to a document. The text names the original shop; the editor swaps in the current shop's name, address and phone.

export interface WarrantyPreset { label: string; months: number; mileage: number; exclusions: string }


export const WARRANTY_PRESETS: WarrantyPreset[] = [
  {
    label: 'No Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
  {
    label: 'Oil Change — 3 Months / 3,000 Miles',
    months: 3,
    mileage: 3000,
    exclusions: `LIMITED WARRANTY: The oil change service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. This warranty covers defects in materials and workmanship for the oil change service, including the oil filter and motor oil installed, for a period of 3 months or 3,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will re-perform the oil change service or replace defective materials at no additional cost, provided the vehicle is returned to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs performed by any other facility without prior written authorization from Alpha will void this warranty immediately.

ACTIVE LEAK EXCLUSION: If the customer knowingly continues to operate the vehicle with an active engine oil leak, coolant leak, or water leak after being advised by Alpha or any qualified technician, and such operation causes or contributes to engine damage or oil starvation, this warranty is void. The customer assumes full responsibility for damages resulting from knowingly driving with an active fluid leak.

EXCLUSIONS: This warranty does not cover: (a) pre-existing engine leaks, oil consumption, or internal engine wear present before service; (b) damage caused by use of non-recommended oil grade, viscosity, or filter after the warranted service; (c) engine damage resulting from neglect, overheating, coolant contamination, or failure to maintain proper fluid levels; (d) damage caused by accident, collision, misuse, abuse, negligence, or unauthorized modification; (e) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (f) customer-supplied parts or fluids. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Oil Change (Synthetic) — 6 Months / 6,000 Miles',
    months: 6,
    mileage: 6000,
    exclusions: `LIMITED WARRANTY: The synthetic oil change service performed by Alpha International Auto Center (\"Alpha\") is warranted to the original customer named on this invoice only and is non-transferable. This warranty covers defects in materials and workmanship for the synthetic oil change service, including the oil filter and full-synthetic motor oil installed, for a period of 6 months or 6,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will re-perform the oil change service or replace defective materials at no additional cost, provided the vehicle is returned to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs performed by any other facility without prior written authorization from Alpha will void this warranty immediately.

ACTIVE LEAK EXCLUSION: If the customer knowingly continues to operate the vehicle with an active engine oil leak, coolant leak, or water leak after being advised by Alpha or any qualified technician, and such operation causes or contributes to engine damage or oil starvation, this warranty is void. The customer assumes full responsibility for damages resulting from knowingly driving with an active fluid leak.

EXCLUSIONS: This warranty does not cover: (a) pre-existing engine leaks, oil consumption, or internal engine wear; (b) damage caused by use of non-recommended oil grade, viscosity, or filter after the warranted service; (c) engine damage resulting from neglect, overheating, coolant contamination, or failure to maintain proper fluid levels; (d) damage caused by accident, collision, misuse, abuse, negligence, or unauthorized modification; (e) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, or any other costs of any kind; (f) customer-supplied parts or fluids. This warranty is in lieu of all other warranties, express or implied.`  
  },
  {
    label: 'Brakes — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The brake repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the brake components replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

MANDATORY RETURN INSPECTION: To maintain this warranty in full force and effect, the customer MUST return the vehicle to Alpha for a mandatory brake bed-in verification inspection between 200 and 500 miles after the repair date. New brake components require a proper bed-in period to perform correctly and to activate warranty protection. Failure to complete this required inspection within 500 miles will void this warranty in its entirety. Upon return, Alpha will inspect brake pad and rotor condition, verify proper bedding, check for noise or vibration issues, and confirm brake system integrity.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective brake components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or adjustments performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation.

MANDATORY BRAKE FLUID MAINTENANCE: This warranty is conditioned upon the customer maintaining clean, uncontaminated brake fluid at the proper level at all times. Brake fluid must be inspected at every oil change interval and replaced if contaminated, discolored, or if moisture content exceeds safe limits. Failure to maintain proper brake fluid condition, which may accelerate corrosion of brake system components and cause premature failure, will void this warranty.

EXCLUSIONS: This warranty does not cover: (a) normal wear and tear of brake pads, shoes, rotors, or drums; (b) brake noise, vibration, or pulsation caused by normal wear, road conditions, improper bed-in, or driving habits; (c) damage caused by accident, collision, misuse, abuse, negligence, improper driving habits (excessive braking, riding the brakes), or unauthorized modification; (d) brake system failures caused by hydraulic leaks, ABS module failures, contaminated brake fluid, or other components not replaced under this invoice; (e) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted on the invoice; (f) pre-existing conditions or failures in unrelated vehicle systems; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts; (i) any failure resulting from non-compliance with the mandatory return inspection requirement set forth above. Alpha reserves the right to warranty wear items (brake pads, shoes, rotors) at its sole discretion. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Engine Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The engine repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific engine components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

MANDATORY RETURN INSPECTION: To maintain this warranty in full force and effect, the customer MUST return the vehicle to Alpha for a mandatory post-repair inspection within 500 miles of the repair date. Failure to complete this required inspection within 500 miles will void this warranty in its entirety, and Alpha shall have no further obligation. Upon return, Alpha will inspect for oil leaks, fluid levels, cooling system integrity, and confirm proper engine operation.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective engine components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

MANDATORY MAINTENANCE REQUIREMENT: This warranty is conditioned upon the customer maintaining the vehicle in accordance with the manufacturer's recommended service schedule. Specifically, engine oil and filter must be changed every 3,000 miles or 3 months, whichever occurs first, using oil of the grade and specification recommended by the manufacturer. The customer must retain all service receipts as proof of compliance. Failure to maintain proper fluid levels, perform scheduled oil changes, or present maintenance records upon Alpha's request will void this warranty in its entirety.

ACTIVE LEAK EXCLUSION: Any oil or fluid leak that is present, visible, or detectable at the time of the warranty claim whether pre-existing, minor, or developing is expressly excluded from warranty coverage. Alpha's obligation under this warranty applies solely to defects in the specific components repaired or replaced on this invoice and does not extend to any condition involving fluid seepage, weeping, or leakage of any kind unless such leak is directly and solely caused by a defect in Alpha's workmanship on the warranted component.

EXCLUSIONS: This warranty does not cover: (a) engine components, sensors, or systems not specifically repaired or replaced on this invoice; (b) damage caused by overheating, coolant loss, oil starvation, or failure to maintain proper fluid levels and scheduled maintenance; (c) pre-existing conditions, sludge buildup, or internal engine wear not addressed in the original repair; (d) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification including aftermarket performance parts, tuning, or engine swaps; (e) head gasket failure caused by overheating events occurring after the repair; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts; (i) any failure resulting from non-compliance with the mandatory return inspection requirement set forth above. The customer must follow all recommended maintenance schedules and return for any required follow-up inspections noted on the invoice. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Engine Rebuild — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The engine rebuild performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the internal engine components replaced during the rebuild (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective internal engine components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation.

MANDATORY RETURN INSPECTIONS — REQUIRED TO MAINTAIN WARRANTY: To activate and preserve full warranty coverage, the customer MUST return the vehicle to Alpha International Auto Center for a complimentary post-rebuild inspection at each of the following odometer milestones after the rebuild date:
  (1) 500 miles after rebuild — Break-in check: valve clearance, oil level, coolant level, and leak inspection.
  (2) 1,500 miles after rebuild — Intermediate check: re-torque of critical fasteners, full fluid check.
  (3) 3,000 miles after rebuild — First oil and filter change, final clearance check.

Failure to complete ALL THREE return inspections at the above milestones will void this warranty in its entirety. After completing the 3,000-mile inspection, you are free to have future oil changes performed at any qualified shop. Alpha will document each inspection on your service record.

MANDATORY MAINTENANCE: Following the 3,000-mile inspection, the customer must adhere to: oil and filter changes every 3,000 miles or 3 months (whichever comes first) using the oil grade and viscosity specified on this invoice. Failure to maintain proper oil change intervals will void this warranty. Customer must retain all maintenance receipts as proof of compliance.

ACTIVE LEAK EXCLUSION: If the customer knowingly continues to operate the vehicle with an active coolant leak, water leak, or engine oil leak after being advised by Alpha or any qualified technician, and such operation causes or contributes to engine overheating, cylinder head damage, bearing failure, or other internal damage, this warranty is void with respect to such damage. The customer assumes full and sole responsibility for all damages resulting from knowingly driving with an active fluid leak.

EXCLUSIONS: This warranty does not cover: (a) external engine components, accessories, sensors, wiring, exhaust, or systems not specifically rebuilt or replaced on this invoice; (b) damage caused by overheating, coolant system failure, oil starvation, or failure to maintain proper fluid levels; (c) pre-existing conditions in unrelated vehicle systems (transmission, electrical, cooling system) that cause engine damage; (d) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification including aftermarket performance parts, tuning, nitrous oxide, superchargers, turbo kits, or engine swaps; (e) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (f) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (g) customer-supplied or used parts; (h) damage resulting from failure to complete required follow-up inspections. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Transmission Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The transmission repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific transmission components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

MANDATORY RETURN INSPECTION: To maintain this warranty in full force and effect, the customer MUST return the vehicle to Alpha for a mandatory post-repair transmission inspection within 500 miles of the repair date. Failure to complete this required inspection within 500 miles will void this warranty in its entirety. Upon return, Alpha will verify fluid condition and level, check for leaks, inspect shift quality, and confirm proper transmission operation under normal driving conditions.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective transmission components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

MANDATORY FLUID MAINTENANCE: This warranty is conditioned upon the customer maintaining the correct type and quantity of transmission fluid as specified for this vehicle. Transmission fluid must be checked at every 15,000-mile interval or as recommended by the manufacturer. Use of incorrect fluid type, failure to maintain proper fluid level, or failure to change fluid at recommended intervals will void this warranty in its entirety.

ACTIVE LEAK EXCLUSION: Any transmission fluid leak that is present, visible, or detectable at the time of the warranty claim whether pre-existing, minor, or developing is expressly excluded from warranty coverage. Alpha's obligation applies solely to defects in the specific components repaired or replaced on this invoice and does not extend to any condition involving fluid seepage, weeping, or leakage of any kind unless directly and solely caused by a defect in Alpha's workmanship on the warranted component.

EXCLUSIONS: This warranty does not cover: (a) transmission components, solenoids, sensors, or systems not specifically repaired or replaced on this invoice; (b) damage caused by fluid neglect, use of incorrect transmission fluid, or failure to maintain proper fluid levels; (c) damage caused by towing abuse, excessive payload, or operating the vehicle beyond its rated capacity; (d) pre-existing conditions, internal wear, or contamination not addressed in the original repair; (e) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts; (i) any failure resulting from non-compliance with the mandatory return inspection requirement set forth above. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Transmission Rebuild — 24 Months / 24,000 Miles',
    months: 24,
    mileage: 24000,
    exclusions: `LIMITED WARRANTY: The transmission rebuild performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the internal transmission components replaced during the rebuild (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective internal transmission components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety.

MANDATORY RETURN INSPECTIONS — REQUIRED TO MAINTAIN WARRANTY: To activate and preserve full warranty coverage, the customer MUST return the vehicle to Alpha for a complimentary post-rebuild inspection at each of the following odometer milestones:
  (1) 500 miles after rebuild — Initial fluid check, leak inspection, shift quality verification, and scan for diagnostic trouble codes.
  (2) 1,500 miles after rebuild — Fluid condition check, re-verification of all seals and gaskets, shift adaptation check.
  (3) 3,000 miles after rebuild — Transmission fluid and filter change, final performance verification.

Failure to complete ALL THREE return inspections will void this warranty in its entirety. Alpha will document each inspection on your service record.

MANDATORY MAINTENANCE: Following the 3,000-mile inspection, the customer must adhere to transmission fluid changes every 30,000 miles or as specified on this invoice. Failure to maintain proper fluid change intervals or use of non-recommended fluid will void this warranty. Customer must retain all maintenance receipts as proof of compliance.

ACTIVE LEAK EXCLUSION: If the customer knowingly continues to operate the vehicle with an active transmission fluid leak after being advised by Alpha or any qualified technician, and such operation causes or contributes to transmission damage, this warranty is void with respect to such damage.

EXCLUSIONS: This warranty does not cover: (a) external transmission components, cooler lines, mounts, sensors, or systems not specifically rebuilt or replaced on this invoice; (b) damage caused by fluid neglect, contamination, or use of incorrect transmission fluid; (c) damage caused by towing abuse, excessive payload, racing, or operating the vehicle beyond its rated capacity; (d) pre-existing conditions in unrelated vehicle systems (engine, electrical, cooling) that cause transmission damage; (e) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (f) vehicles used for commercial purposes unless expressly noted; (g) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, business interruption, or any other costs of any kind; (h) customer-supplied or used parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Electrical / Diagnostics — 6 Months / 6,000 Miles',
    months: 6,
    mileage: 6000,
    exclusions: `LIMITED WARRANTY: The electrical/diagnostic repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific electrical components or sensors replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 6 months or 6,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective electrical components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty.

EXCLUSIONS: This warranty does not cover: (a) electrical components, wiring, modules, or sensors not specifically replaced on this invoice; (b) damage caused by water intrusion, rodent damage, corrosion, or wiring harness failures unrelated to the repair; (c) aftermarket electrical accessories, stereos, alarms, remote starters, or lighting modifications that affect the repaired system; (d) intermittent electrical faults that cannot be replicated during diagnosis; (e) damage caused by jump-starting, incorrect battery installation, or electrical surges; (f) pre-existing conditions or failures in unrelated vehicle systems; (g) damage caused by accident, collision, flood, misuse, abuse, negligence, or unauthorized modification; (h) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind; (i) customer-supplied parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Suspension — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The suspension repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific suspension components replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

MANDATORY RETURN INSPECTION: To maintain this warranty in full force and effect, the customer MUST return the vehicle to Alpha for a mandatory post-repair suspension and alignment verification inspection within 500 miles of the repair date. Suspension repairs directly affect vehicle alignment, and failure to complete this required inspection within 500 miles will void this warranty in its entirety. Upon return, Alpha will verify wheel alignment within manufacturer specifications, inspect component torque and seating, check for abnormal noise or vibration, and confirm proper vehicle handling.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace defective suspension components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization will void this warranty.

EXCLUSIONS: This warranty does not cover: (a) wheel alignment services alignment is a separate service and is not warranted against future misalignment caused by road conditions or normal driving; (b) tire wear, tire damage, or uneven tire wear regardless of cause; (c) suspension components not specifically replaced on this invoice; (d) damage caused by road hazards, potholes, curb strikes, speed bumps, or off-road driving; (e) damage caused by accident, collision, misuse, abuse, negligence, vehicle overloading, or unauthorized modification including lift kits and lowering kits; (f) noise or vibration caused by normal wear or unrelated components; (g) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted; (h) pre-existing conditions or failures in unrelated vehicle systems; (i) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, death, property damage, or any other costs of any kind; (j) customer-supplied or used parts; (k) any failure resulting from non-compliance with the mandatory return inspection requirement set forth above. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'AC / Heating — 6 Months / 6,000 Miles',
    months: 6,
    mileage: 6000,
    exclusions: `LIMITED WARRANTY: The AC/heating repair performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific AC/heating components repaired or replaced (as documented on this invoice) will be free from defects in materials and workmanship under normal, non-commercial use for a period of 6 months or 6,000 miles from the date and odometer reading on this invoice, whichever occurs first.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, repair or replace the specific defective AC/heating components covered under this invoice at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs or service performed by any other facility without prior written authorization will void this warranty.

EXCLUSIONS: This warranty does not cover: (a) AC/heating components not specifically repaired or replaced on this invoice; (b) refrigerant leaks originating from components not serviced under this invoice; (c) compressor failure caused by pre-existing contamination, debris, or system neglect not addressed in the original repair; (d) cabin air filters, blend door actuators, or ductwork not replaced under this invoice; (e) reduced cooling performance caused by clogged condenser, radiator fan failure, or engine overheating; (f) damage caused by accident, collision, misuse, abuse, negligence, or unauthorized modification; (g) vehicles used for commercial purposes unless expressly noted; (h) pre-existing conditions or failures in unrelated vehicle systems; (i) consequential or incidental damages including but not limited to towing charges, vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind; (j) customer-supplied parts. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'Body & Paint — 6 Months (Cosmetic)',
    months: 6,
    mileage: 0,
    exclusions: `LIMITED WARRANTY: The body and paint work performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that the specific body and paint work performed (as documented on this invoice) will be free from defects in workmanship for a period of 6 months from the date on this invoice.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, at its sole discretion, re-perform the defective body or paint work at no additional cost. The customer must return the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed.

EXCLUSIONS: This warranty does not cover: (a) rock chips, scratches, dents, or physical damage occurring after the repair; (b) paint fading, discoloration, or oxidation caused by sun exposure, weather, chemicals, bird droppings, tree sap, or environmental contamination; (c) damage caused by improper washing techniques, automatic car washes, abrasive cleaners, or failure to maintain the finish; (d) paint or body work on panels or areas not documented on this invoice; (e) color matching variations that are within industry-accepted tolerances; (f) rust or corrosion originating from areas not treated during the repair; (g) damage caused by accident, collision, vandalism, misuse, abuse, or negligence; (h) consequential or incidental damages including but not limited to vehicle rental, lost wages, personal injury, property damage, or any other costs of any kind. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose.`
  },
  {
    label: 'State Inspection — No Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
  {
    label: 'General Repair — 12 Months / 12,000 Miles',
    months: 12,
    mileage: 12000,
    exclusions: `LIMITED WARRANTY: The repair service performed by Alpha International Auto Center ("Alpha") is warranted to the original customer named on this invoice only and is non-transferable. Alpha warrants that all parts and labor sold in connection with the services documented on this invoice will be free from defects in materials and workmanship under normal, non-commercial use for a period of 12 months or 12,000 miles from the date and odometer reading on this invoice, whichever occurs first.

MANDATORY RETURN INSPECTION: To maintain this warranty in full force and effect, the customer MUST return the vehicle to Alpha for a mandatory post-repair inspection within 500 miles of the repair date. Failure to complete this required inspection within 500 miles will void this warranty in its entirety, and Alpha shall have no further obligation. Upon return, Alpha will inspect the warranted repair for proper function, fluid integrity, and absence of leaks or abnormal conditions.

CONDITIONS & REMEDY: As the customer's sole and exclusive remedy, Alpha will, with reasonable promptness and subject to parts availability, repair or replace at its sole discretion any defective parts or components covered under this invoice and perform any labor reasonably necessary to complete such repair at no additional cost. The customer must deliver the vehicle to Alpha during normal business hours. Alpha must be contacted before any warranty-related service is performed. Repairs, diagnostics, or service performed by any other facility without prior written authorization from Alpha will immediately void this warranty in its entirety, and Alpha shall have no further obligation to honor this warranty.

ACTIVE LEAK EXCLUSION: Any fluid leak that is present, visible, or detectable at the time of the warranty claim whether pre-existing, minor, or developing is expressly excluded from warranty coverage. Alpha's obligation under this warranty applies solely to defects in the specific parts or labor documented on this invoice and does not extend to any fluid seepage, weeping, or leakage of any kind unless directly and solely caused by a defect in Alpha's workmanship on the warranted component.

EXCLUSIONS: This warranty does not cover, nor extend to: (a) any repairs, replacements, or service made necessary by accident, collision, misuse, abuse, negligence, neglect, or any cause other than normal use and operation of the vehicle; (b) any parts, components, or systems not specifically repaired or replaced as documented on this invoice; (c) pre-existing conditions, wear, or failures in unrelated vehicle systems; (d) damage resulting from unauthorized modifications, tampering, or alteration to the warranted repair by anyone other than Alpha; (e) used parts purchased at customer's request or parts supplied by the customer; (f) vehicles used for commercial, racing, towing, or off-road purposes unless expressly noted on the invoice; (g) customer's towing charges, car rental, lodging, lost wages, interruption of business, personal injury, death, property damage, or any other charges, damages, liability, or costs of any kind whatsoever, whether incidental or consequential; (h) any repairs or replacements made by another repair facility without prior written authorization from Alpha; (i) any failure resulting from non-compliance with the mandatory return inspection requirement set forth above.

GENERAL PROVISIONS: Should any tampering or alteration to the warranted repair or systems be found at the time of a warranty claim, Alpha reserves the right to deny warranty coverage. This warranty is in lieu of all other warranties, express or implied, including any implied warranty of merchantability or fitness for a particular purpose. Alpha's total liability under this warranty shall not exceed the original amount paid for the repair as documented on this invoice.`
  },
  {
    label: 'Custom Warranty',
    months: 0,
    mileage: 0,
    exclusions: ''
  },
]
