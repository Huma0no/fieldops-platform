# Catalog Review

Datos extraídos de `data.js`. Para revisión humana antes de importar al catálogo de producción.

---

## Services

> **Bundle** — AC & Heat se cobra como una sola unidad ($30 total, no $30+$30).
> **Standalone** — No se puede combinar con AC ni Heat (Prestart, Drive Run, Cancel son mutuamente excluyentes con servicios de refrigeración).

| Service | Price | Bundle | Standalone |
|---|---|---|---|
| AC | $30 | — | — |
| Heat | $30 | — | — |
| AC & Heat | $30 | ✓ | — |
| Prestart | $20 | — | ✓ |
| Drive Run | $10 | — | ✓ |
| Cancel | $0 | — | ✓ |

> **Finish** is a modifier, not a service — no catalog entry, no standalone price. Pricing rules handled by the pricing engine. See `DATA_PLAN.md` §4.2.

---

## Accessories

> **Multiplies** — El precio se duplica cuando el trabajo cubre dos sistemas.
> **Tech supplied** — El técnico lleva y cobra el item desde su inventario personal.
> **Custom price** — No tiene precio fijo; el usuario ingresa el monto en campo.
> **Companion items** — Se activan automáticamente al seleccionar el item padre.
> **Zone board** — Mutuamente excluyente con los otros zone boards (HZ322, Harmony, UT3000); seleccionar uno deselecciona los demás y sus companions.
> Reglas de combinación con modificadores (Finish, etc.) se revisan en el price engine, no en este documento.

| Accessory | Price | Multiplies | Tech Supplied | Custom Price | Companion Items | Zone Board |
|---|---|---|---|---|---|---|
| FIN180P | $10 | — | — | — | — | — |
| FIN6-MD | $10 | — | — | — | — | — |
| Float Switch | $5 | ✓ | ✓ | — | — | — |
| Dehum | $10 | — | — | — | — | — |
| F/A | $10 | — | — | — | — | — |
| Harmony | $40 | — | ✓ | — | — | ✓ |
| HZ322 | $30 | — | ✓ | — | Bypass | ✓ |
| UT3000 | $30 | — | ✓ | — | DAPC, eBypass, Ecoil Wire | ✓ |
| Bypass | $5 | — | — | — | — | — |
| eBypass | $10 | — | — | — | — | — |
| DAPC | $10 | — | ✓ | — | — | — |
| AprilAir | $10 | — | — | — | — | — |
| RDS | $10 | ✓ | ✓ | — | — | — |
| Trane Harness | $10 | ✓ | — | — | — | — |
| Ecoil Wire | $10 | ✓ | — | — | — | — |
| LP Kit Lennox 1stg | $20 | ✓ | ✓ | — | — | — |
| LP Kit Lennox 2stg | $20 | ✓ | ✓ | — | — | — |
| LP Kit Goodman | $20 | ✓ | ✓ | — | — | — |
| Weight-In-Data | $10 | ✓ | — | — | — | — |
| Out of town fee | — | — | — | ✓ | — | — |
| Other | — | — | — | ✓ | — | — |

---

## Fixes

> **Custom price** — No tiene precio fijo; el usuario ingresa el monto en campo.
> "Other" en fixes se registra en el catálogo como **"Other Fix"** para no colisionar con el accessory "Other".

| Fix | Price | Custom Price |
|---|---|---|
| Pressure Test | $10 | — |
| Open Ecoil | $30 | — |
| Wires Jammed | $5 | — |
| Stuck Blower | $20 | — |
| Cut Sheetrock | $15 | — |
| Extended Wire | $5 | — |
| Extended Wire (Furnace) | $5 | — |
| Extended Wire (Cunit) | $5 | — |
| Leaks Ecoil | $20 | — |
| Leaks Cunit | $20 | — |
| Leaks Wall | $50 | — |
| Other Fix | — | ✓ |

---

## Thermostats

> El thermostat no tiene precio propio en el catálogo (`default_price = 0`). Su costo se deriva de la combinación de service + accessories + fixes de la visita — eso se resuelve en el price engine, no aquí. Todos son tech supplied.

| Thermostat |
|---|
| T-4 |
| T-6 |
| T-10 |
| T-8321 |
| Ecobee |
| Daikin One |
| TH2110 |

---

## Builders

| Builder |
|---|
| Lennar |
| MHI |
| Highland |
| CastleRock |
| First America |
| Chesmar |

---

## Equipment — Indoor

> pESP = posible ESP de referencia (lecturas de campo previas). "—" indica sin datos disponibles.

### Lennox — ML180UH SERIES

| Model | Unit Type | pESP |
|---|---|---|
| ML180UH045E36A | Furnace | 0.6 |
| ML180UH070E36A | Furnace | 0.9 |
| ML180UH070E36B | Furnace | 0.9 |
| ML180UH090E48B | Furnace | — |
| ML180UH090E60C | Furnace | 1.0 |
| ML180UH110E60C | Furnace | 1.0 |
| ML180UH135E60D | Furnace | — |

### Lennox — ML180UHV SERIES (Dip Switch)

| Model | Unit Type | pESP |
|---|---|---|
| ML180UH030V36A | Furnace | — |
| ML180UH045V36A | Furnace | — |
| ML180UH070V36A | Furnace | — |
| ML180UH070V48B | Furnace | — |
| ML180UH090V48B | Furnace | — |
| ML180UH110V60C | Furnace | — |

### Lennox — ML196UH SERIES (High Efficiency)

| Model | Unit Type | pESP |
|---|---|---|
| ML196UH030XE36B | Furnace | 0.7 |
| ML196UH045XE36B | Furnace | 0.6 |
| ML196UH070XE36B | Furnace | 0.7 |
| ML196UH070XE48B | Furnace | — |
| ML196UH090XE36C | Furnace | — |
| ML196UH090XE48C | Furnace | 0.7 |
| ML196UH090XE60C | Furnace | 1.0 |
| ML196UH110XE60C | Furnace | 1.0 |
| ML196UH135XE60D | Furnace | — |

### Lennox — ML296UH SERIES

| Model | Unit Type | pESP |
|---|---|---|
| ML296UH045XV36B | Furnace | — |
| ML296UH070XV36B | Furnace | — |
| ML296UH090XV48C | Furnace | — |
| ML296UH110XV60C | Furnace | — |

### Lennox — EL196UH SERIES

| Model | Unit Type | pESP |
|---|---|---|
| EL196UH030XE36BK | Furnace | 0.0 |
| EL196UH045XE36BK | Furnace | 0.0 |
| EL196UH070XE36BK | Furnace | 0.7 |
| EL196UH090XE48CK | Furnace | 0.7 |
| EL196UH110XE60CK | Furnace | 0.7 |

### Lennox — CBK45UHET SERIES

| Model | Unit Type | pESP |
|---|---|---|
| CBK45UHET024 | Air Handler | — |
| CBK45UHET030 | Air Handler | — |
| CBK45UHET036 | Air Handler | — |
| CBK45UHET042 | Air Handler | — |
| CBK45UHET048 | Air Handler | — |
| CBK45UHET060 | Air Handler | — |

### Lennox — CBA25UH SERIES

| Model | Unit Type | pESP |
|---|---|---|
| CBA25UH018 | Air Handler | — |
| CBA25UH024 | Air Handler | — |
| CBA25UH030 | Air Handler | — |
| CBA25UH036 | Air Handler | — |
| CBA25UH042 | Air Handler | — |
| CBA25UH048 | Air Handler | — |
| CBA25UH060 | Air Handler | — |

### Trane — S8X1/S8X2-S8B1

| Model | Unit Type | pESP |
|---|---|---|
| S8X1A040M3PSC | Furnace | — |
| S8X1B040M2PSC | Furnace | 0.9 |
| S8X1B060M4PSC | Furnace | 0.8 |
| S8X1B080M4PSC | Furnace | — |
| S8X1C080M5PSC | Furnace | — |
| S8X1C100M5PSC | Furnace | — |
| S8X1D120M5PSC | Furnace | — |

### Goodman — GR9S80 SERIES

| Model | Unit Type | pESP |
|---|---|---|
| GR9S800403AU | Furnace | 0.0 |
| GR9S800603AU | Furnace | 0.6 |
| GR9S800604BU | Furnace | — |
| GR9S800804BU | Furnace | — |
| GR9S800805CU | Furnace | — |

### Goodman — AMSTU1300 SERIES

| Model | Unit Type | pESP |
|---|---|---|
| AMST24BU | Air Handler | — |
| AMST30BU | Air Handler | — |
| AMST36BU | Air Handler | — |
| AMST36CU | Air Handler | — |
| AMST42CU | Air Handler | — |
| AMST48CU | Air Handler | — |
| AMST48DU | Air Handler | — |
| AMST60DU | Air Handler | — |

### Daikin — DR96TC / DD96TC SERIES

| Model | Unit Type | pESP |
|---|---|---|
| DR96TC0403BN | Furnace | 0.5 |
| DR96TC0603BN | Furnace | 0.5 |
| DR96TC0803BN | Furnace | 0.5 |
| DR96TC0804CN | Furnace | 0.5 |
| DR96TC1005CN | Furnace | 0.5 |
| DR96TC1005DN | Furnace | 0.5 |
| DR96TC1205DN | Furnace | 0.5 |
| DD96TC0403BN | Furnace | 0.5 |
| DD96TC0603BN | Furnace | 0.5 |
| DD96TC0804CN | Furnace | 0.5 |
| DD96TC1005CN | Furnace | 0.5 |
| DD96TC1205DN | Furnace | 0.5 |

---

## Equipment — Outdoor

> **Factory Charge** — carga de fábrica en oz según nameplate.
> **Revised Charge** — carga actualizada para unidades fabricadas después de mayo 2025 (ajuste por escasez de R-454B). El técnico determina en campo cuál aplica según fecha de fabricación. "—" indica que aún no está verificada en campo.
> **Decisión:** R-410A se mantiene en el catálogo como legacy activo. Las series ML17XC1, ML18XC2, EL17XP1 y 4TTR se siembran junto con el resto del equipo.

### Lennox — ML17XC1 (R-410A)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| ML17XC1-018 | Condenser | 18,000 | R-410A | 72 | — |
| ML17XC1-024 | Condenser | 24,000 | R-410A | 82 | — |
| ML17XC1-030 | Condenser | 30,000 | R-410A | 104 | — |
| ML17XC1-036 | Condenser | 36,000 | R-410A | 136 | — |
| ML17XC1-042 | Condenser | 42,000 | R-410A | 146 | — |
| ML17XC1-047 | Condenser | 47,000 | R-410A | 157 | — |
| ML17XC1-059 | Condenser | 59,000 | R-410A | 190 | — |

### Lennox — ML18XC2 (R-410A)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| ML18XC2-036 | Condenser | 36,000 | R-410A | 128 | — |
| ML18XC2-048 | Condenser | 48,000 | R-410A | 177 | — |

### Lennox — EL17XP1 (R-410A, Heat Pump)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| EL17XP1-18 | Heat Pump | 18,000 | R-410A | 92 | — |
| EL17XP1-24 | Heat Pump | 24,000 | R-410A | 90 | — |
| EL17XP1-30 | Heat Pump | 30,000 | R-410A | 111 | — |
| EL17XP1-36 | Heat Pump | 36,000 | R-410A | 131 | — |
| EL17XP1-42 | Heat Pump | 42,000 | R-410A | 156 | — |
| EL17XP1-48 | Heat Pump | 48,000 | R-410A | 140 | — |
| EL17XP1-60 | Heat Pump | 60,000 | R-410A | 158 | — |

### Lennox — ML14KC1 (R-454B)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| ML14KC1-018 | Condenser | 18,000 | R-454B | 78 | 92 |
| ML14KC1-024 | Condenser | 24,000 | R-454B | 78 | 87 |
| ML14KC1-030 | Condenser | 30,000 | R-454B | 90 | 99 |
| ML14KC1-036 | Condenser | 36,000 | R-454B | 109 | 118 |
| ML14KC1-041 | Condenser | 41,000 | R-454B | 119 | 128 |
| ML14KC1-042 | Condenser | 42,000 | R-454B | 114 | 123 |
| ML14KC1-047 | Condenser | 47,000 | R-454B | 125 | 134 |
| ML14KC1-048 | Condenser | 48,000 | R-454B | 142 | 151 |
| ML14KC1-059 | Condenser | 59,000 | R-454B | 152 | 161 |
| ML14KC1-060 | Condenser | 60,000 | R-454B | 142 | 151 |

### Lennox — ML17KC2 (R-454B)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| ML17KC2-024 | Condenser | 24,000 | R-454B | 100 | — |
| ML17KC2-036 | Condenser | 36,000 | R-454B | 104 | — |
| ML17KC2-048 | Condenser | 48,000 | R-454B | 126 | — |
| ML17KC2-060 | Condenser | 60,000 | R-454B | 149 | — |

### Trane — 4TTR (R-410A)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| 4TTR6024N1000AA | Condenser | 24,000 | R-410A | 148 | — |
| 4TTR5042A1000AA | Condenser | 42,000 | R-410A | 130 | — |
| 4TTR5048A1000AA | Condenser | 48,000 | R-410A | 114 | — |
| 4TTR5060A1000AA | Condenser | 60,000 | R-410A | 152 | — |

### Trane — 5TTR (R-454B)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| 5TTR5018 | Condenser | 18,000 | R-454B | 60 | — |
| 5TTR5024 | Condenser | 24,000 | R-454B | 58 | 83 |
| 5TTR5030 | Condenser | 30,000 | R-454B | 56 | — |
| 5TTR5036 | Condenser | 36,000 | R-454B | 56 | 80 |
| 5TTR5042 | Condenser | 42,000 | R-454B | 81 | — |
| 5TTR5048 | Condenser | 48,000 | R-454B | 106 | 130 |
| 5TTR5060 | Condenser | 60,000 | R-454B | 95 | 119 |

### Goodman — GLXS4BA (R-32)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| GLXS4BA1810AA | Condenser | 18,000 | R-32 | 53 | — |
| GLXS4BA2410AA | Condenser | 24,000 | R-32 | 53 | — |
| GLXS4BA3010AA | Condenser | 30,000 | R-32 | 63 | — |
| GLXS4BA3610AA | Condenser | 36,000 | R-32 | 69 | — |
| GLXS4BA4210AA | Condenser | 42,000 | R-32 | 83 | — |
| GLXS4BA4810AA | Condenser | 48,000 | R-32 | 91 | — |
| GLXS4BA6010AA | Condenser | 60,000 | R-32 | 94 | — |

### Goodman — GLXS5BA (R-32)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| GLXS5BA1810AA | Condenser | 18,000 | R-32 | 54 | — |
| GLXS5BA2410AA | Condenser | 24,000 | R-32 | 65 | — |
| GLXS5BA3010AA | Condenser | 30,000 | R-32 | 87 | — |
| GLXS5BA3610AA | Condenser | 36,000 | R-32 | 88 | — |
| GLXS5BA4210AA | Condenser | 42,000 | R-32 | 141 | — |
| GLXS5BA4810AA | Condenser | 48,000 | R-32 | 138 | — |
| GLXS5BA6010AA | Condenser | 60,000 | R-32 | 167 | — |

### Goodman — GLZS4BA (R-32, Heat Pump)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| GLZS4BA1810AA | Heat Pump | 18,000 | R-32 | 70 | — |
| GLZS4BA2410AA | Heat Pump | 24,000 | R-32 | 70 | — |
| GLZS4BA3010AA | Heat Pump | 30,000 | R-32 | 81 | — |
| GLZS4BA3610AA | Heat Pump | 36,000 | R-32 | 83 | — |
| GLZS4BA4210AA | Heat Pump | 42,000 | R-32 | 139 | — |
| GLZS4BA4810AA | Heat Pump | 48,000 | R-32 | 174 | — |
| GLZS4BA6010AA | Heat Pump | 60,000 | R-32 | 194 | — |

### Daikin — DC6VSS (R-32)

| Model | Type | BTU | Refrigerant | Factory Charge (oz) | Revised Charge (oz) |
|---|---|---|---|---|---|
| DC6VSS2410 | Condenser | 24,000 | R-32 | 74 | — |
| DC6VSS3010 | Condenser | 30,000 | R-32 | 76 | — |
| DC6VSS3610 | Condenser | 36,000 | R-32 | 83 | — |
| DC6VSS4210 | Condenser | 42,000 | R-32 | 100 | — |
| DC6VSS4810 | Condenser | 48,000 | R-32 | NULL (pendiente verificación de campo) | — |
| DC6VSS6010 | Condenser | 60,000 | R-32 | NULL (pendiente verificación de campo) | — |
