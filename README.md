# A salvo

Aplicación web en español para preparar una **guía familiar orientativa de emergencias**. React, TypeScript, Vite y un servidor Express, con exportación PDF local.

## Arrancar

Requiere Node.js 22 o posterior.

```powershell
npm install
npm run dev
```

Abre `http://localhost:5173`. El mismo servidor sirve la interfaz y la API.

```powershell
npm test
npm run build
npm start
```

`npm start` sirve la compilación de `dist`. `PORT` permite cambiar el puerto y `HOST` la interfaz de escucha. Por defecto solo escucha en `127.0.0.1`. Para un despliegue público configura HTTPS, un proxy inverso y límites de peticiones por cliente; la geolocalización requiere HTTPS fuera de localhost. El límite global en memoria de esta versión local no sustituye un control de tráfico de producción.

## Funcionalidades

- **Municipio validado mientras escribes**: sugerencias a partir de la relación oficial de municipios del INE (8.132 municipios a 1 de enero de 2026, `server/data/municipios-ine-2026.json`), tolerantes a tildes y artículos («rozas» → Las Rozas de Madrid). Solo se puede continuar tras elegir uno de la lista; se guarda su código INE y fija la provincia y el organismo autonómico.
- **Calle y número opcionales**, validados con el callejero de CartoCiudad (IGN) dentro del municipio elegido. Una dirección verificada genera al momento el mapa de inundaciones, incendios y terremotos centrado en tu portal y consulta esos peligros en ese punto, sin pasos adicionales.
- Ubicación opcional mediante permiso del navegador y geocodificación inversa en CartoCiudad (IGN). Se envían coordenadas redondeadas a tres decimales, sin guardarlas en la aplicación.
- **Perfil del hogar** en 5 pasos: personas, planta (sótano, baja o alta), tipo de vivienda, garaje o sótano, cercanía a cauces y a vegetación, vehículo, 7 necesidades (menores, mayores, movilidad reducida, medicación, equipos eléctricos, discapacidad sensorial y animales), contactos y puntos de encuentro dentro y fuera del barrio.
- **Motor de personalización** (`shared/personalize.ts`): reglas deterministas que activan, descartan y ordenan acciones según el perfil y la consulta cartográfica del punto marcado. Cada acción muestra «Por qué para ti» y su fuente numerada; las que no proceden de un organismo se etiquetan como sugerencia de organización del hogar. El plan destaca 5 prioridades y separa las fases antes, aviso, durante y después, con tareas marcables.
- **Kit calculado**: agua `personas × 3 L × 3 días` y comida `personas × 9 raciones` (72 h, Comisión Europea y guía «Preparat» de la Generalitat de Catalunya), más artículos condicionados a las necesidades y escenarios.
- Recomendaciones autonómicas verificadas para los 19 territorios, con enlace a su fuente concreta.
- Mapa con cartografía IGN, inundación fluvial T100/T500 del SNCZI, FWI oficial EFFIS y peligrosidad sísmica del IGN. **Consulta automática en la vivienda**: dentro o fuera de cada zona cartografiada, tramo estudiado, año de aprobación, FWI del día e intensidad sísmica EMS-98; se incorpora al plan y al PDF.
- Consulta de las fuentes oficiales desde el servidor, con errores visibles y hora de comprobación (caché de 15 minutos).
- PDF con portada, aviso, perfil, 5 prioridades justificadas, comunicación, cartografía del punto e imagen del mapa, una página por escenario, consejos autonómicos, kit con estado y fuentes numeradas con enlace.
- Progreso guardado localmente solo mediante acción expresa. Borrado desde Ayuda y privacidad.
- Diseño minimalista adaptable a móvil, navegación por teclado y asistente con diálogo modal nativo.

### Fuentes verificadas usadas por el motor

Solo se citan afirmaciones contrastadas con el documento original: guías de autoprotección de Protección Civil (inundaciones pp. 13–15, incendios forestales pp. 12 y 18, riesgo sísmico p. 13), ES-Alert (Protección Civil), Estrategia de la Unión de Preparación (Comisión Europea, 72 h), «Preparat per a les emergències» 2025 (Generalitat de Catalunya: agua 3 L/persona/día, contacto fuera del municipio, cortes de suministros, discapacidad y mascotas), Ministerio de Sanidad (registro de personas electrodependientes; vivir en soledad como factor de vulnerabilidad), SNCZI (MITECO), EFFIS (Copernicus) e IGN (Mapa de Peligrosidad Sísmica 2015). Las acciones sin respaldo verificable no llevan fuente y se presentan como sugerencias.

## Alcance y seguridad del contenido

**No es un plan oficial, un servicio de alertas ni un sistema de cálculo de riesgo geográfico.** No genera rutas ni refugios, no confirma puntos de encuentro y no decide entre evacuación y confinamiento. El usuario debe contrastar un plan real con Protección Civil y seguir siempre las instrucciones oficiales. El 112 se reserva para emergencias.

La guía es una **selección editorial** con versión explícita en `shared/advice.ts`. No utiliza generación libre mediante un modelo de lenguaje. `shared/sources.ts` identifica las fuentes nacionales y los portales autonómicos; `shared/regional-advice.ts` contiene los consejos territoriales con enlace, organismo y fecha de revisión. Las sugerencias de organización del hogar se identifican por separado.

La API descarga contenido de las fuentes permitidas, comprueba la respuesta e informa de su accesibilidad. **No interpreta cambios en el contenido ni certifica su vigencia.** No presenta instrucciones locales como si se hubieran extraído automáticamente. Una consulta fallida no se presenta como exitosa: la guía y el PDF conservan el aviso. Antes de un uso público real es necesaria una revisión profesional de contenido, accesibilidad y políticas de mantenimiento de fuentes.

## Datos

No hay base de datos, cuentas, analítica ni recursos tipográficos de terceros: las fuentes se sirven localmente. Al consultar las recomendaciones solo se envían provincia/comunidad y escenarios. Las sugerencias de municipio se resuelven en nuestro servidor con el fichero del INE, sin terceros. El texto de la calle y el código del municipio se reenvían desde nuestro servidor a CartoCiudad para sugerir y validar la dirección, sin guardarse; la dirección solo se conserva en el navegador si el usuario guarda su plan. Para centrar el mapa se envían municipio y provincia a CartoCiudad; las imágenes se solicitan mediante un proxy de destinos fijos. Al validar la dirección o marcar un punto, sus coordenadas redondeadas se envían al SNCZI (MITECO), a EFFIS y al IGN, sin guardarse. Ni los contactos ni las necesidades del hogar se envían al servidor. Los organismos reciben las peticiones descritas; sus propias políticas son aplicables.

## Cartografía y método científico

- **Inundación:** WMS actual `https://gis.miteco.gob.es/geoserver/agua/wms`, capas `Zi_laminas_q100` y `Zi_laminas_q500`, EPSG:3857. No cubren toda inundación pluvial o costera ni garantizan continuidad territorial. Los periodos de retorno no indican fechas futuras.
- **Incendio:** `https://maps.effis.emergency.copernicus.eu/gwis`, mapa `ecmwf.fwi`, consulta de valores `ecmwf.query`. Se usa el cálculo científico oficial, sin pesos propios ni conversión a probabilidad. FWI integra FFMC/DMC/DC, ISI y BUI con temperatura, humedad, viento y precipitación. Resolución ECMWF aproximada: 8 km.
- El WMS de EFFIS anuncia un rango temporal hasta 2099: **no se interpreta como datos disponibles**. El servidor solicita la fecha UTC actual y comprueba valores numéricos en un punto terrestre antes de habilitar la capa. La fecha de emisión de la ejecución no está confirmada y se indica expresamente. No hay recuperación silenciosa de datos de otro día.
- **Terremoto:** WMS `https://www.ign.es/wms-inspire/geofisica`, capas `HazardArea2015.Int475` (intensidad EMS-98) y `HazardArea2015.PGA475_p` (aceleración en g) del Mapa de Peligrosidad Sísmica de España 2015 (IGN). Valores con un 10 % de probabilidad de superarse en 50 años (periodo de retorno de 475 años), en roca y a escala regional: no es una predicción ni evalúa el comportamiento de un edificio.
- La ausencia de color o de una muestra nunca se interpreta como riesgo cero. No se calculan hectáreas a partir de píxeles WMS.
- **Consulta puntual** (`POST /api/maps/point`, `{lat, lon}`): el servidor redondea a 4 decimales (≈10 m) y lanza `GetFeatureInfo` en formato `text/plain` sobre T100 y T500 (sin geometría, respuesta acotada) , la consulta de valores FWI de EFFIS y la intensidad y PGA del IGN. Devuelve `inside`/`outside`/`unknown`, tramo (`rio`), tipo de estudio, año de aprobación y `seismic` (`intensity`, `pga`). No almacena las coordenadas.
- **Mapa automático:** al validar la dirección (o el municipio) se genera solo el mapa en el asistente, en «Mapa de mi zona» y en la guía, con pestañas Inundación / Incendio / Terremoto y la vivienda marcada. La consulta en la dirección se incorpora automáticamente al plan; si la cartografía sugiere un peligro no seleccionado, la guía lo avisa. Un clic en otro punto se consulta aparte y solo se usa si el usuario lo confirma. El PDF incluye el mapa centrado en la dirección.
- `POST /api/sources/check` acepta `extra`: identificadores de `generalSources` (fuentes generales citadas por el motor); cualquier otro valor se rechaza con 400.
- **Ubicación validada:** `GET /api/geo/municipalities?q=&province=` (INE, local); `GET /api/geo/addresses?q=&municipality=<código INE>` (candidatos de calle y portal de CartoCiudad, filtrados por código de municipio); `POST /api/geo/addresses/resolve {id, type, municipality}` (coordenadas y código postal, comprobando que pertenecen al municipio). Límite propio de 240 búsquedas/min y rechazo de peticiones de otros sitios. Para regenerar el fichero del INE: `node scripts/build-municipalities.cjs diccionario26.xlsx`.
- Se muestra una capa temática por vez para no mezclar las clases del incendio con colores de inundación. Los colores originales se conservan en las leyendas; se aplica transparencia en el mapa y se indica en la exportación.
- El proxy verifica MIME, firma PNG, dimensiones, tamaño y tiempo de respuesta; tiene caché acotada en memoria y limita la concurrencia. No admite URLs ni capas arbitrarias. El mapa está implementado con React y servicios WMS, sin dependencias cartográficas remotas.
- Atribución: **IGN** (cartografía base y peligrosidad sísmica), **SNCZI/MITECO (CC BY 4.0)** y **European Union / Copernicus EMS — EFFIS; ECMWF**. Véase la [licencia EFFIS](https://forest-fire.emergency.copernicus.eu/about-effis/data-license). Las exportaciones incluyen fuentes, fechas y la modificación de transparencia.

El PDF puede contener los datos que el usuario haya escrito. No debe compartirse sin revisarlo. El borrado de datos del navegador no elimina archivos descargados. Si se despliega tras un proxy, configura también sus registros para no almacenar coordenadas ni cuerpos de peticiones.

## Estructura

- `src/`: interfaz, ilustraciones SVG y PDF.
- `shared/`: tipos, catálogo territorial, fuentes, recomendaciones y motor de personalización (`personalize.ts`).
- `server/`: API de fuentes y consulta de ubicación con destinos limitados.
- `tests/`: pruebas con el ejecutor nativo de Node, sin depender de servicios oficiales en directo.
- `e2e/`: recorrido de navegador con Playwright; `npm run test:e2e` utiliza Microsoft Edge instalado.
