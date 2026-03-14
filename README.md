# AveSampler — Sistema PWA de Registro de Muestreo de Aves

Sistema Progressive Web App (PWA) para recolección de datos biológicos en campo,
con generación automática de reportes LaTeX y empaquetado en ZIP.

---

## 📁 Estructura del proyecto

```
app/
├── index.html          ← Interfaz principal (4 secciones)
├── style.css           ← Estilos (estética campo/científico)
├── app.js              ← Lógica: formularios, LaTeX, ZIP
├── manifest.json       ← Configuración PWA
├── service-worker.js   ← Caché offline
├── icons/              ← Iconos PWA (72–512px)
│   ├── icon-72.png
│   ├── icon-96.png
│   ├── icon-128.png
│   ├── icon-144.png
│   ├── icon-152.png
│   ├── icon-192.png
│   ├── icon-384.png
│   └── icon-512.png
└── README.md           ← Este archivo
```

---

## 🚀 Cómo desplegar

### Opción 1 — Servidor local simple (desarrollo)

```bash
# Python 3
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Luego abrir: http://localhost:8080
```

### Opción 2 — GitHub Pages (gratis)

1. Crea un repositorio en GitHub
2. Sube todos los archivos
3. Ve a Settings → Pages → Deploy from branch (main)
4. La app estará en `https://TU-USUARIO.github.io/REPO/`

### Opción 3 — Netlify / Vercel (gratis)

1. Arrastra la carpeta `app/` a netlify.com/drop
2. Obtienes una URL HTTPS inmediatamente
3. La PWA se puede instalar desde esa URL

### Opción 4 — Hosting propio

Cualquier servidor web estático (Apache, Nginx).
Requiere HTTPS para que el Service Worker funcione.

---

## 📱 Instalación en dispositivos

### Computador (Chrome/Edge)
1. Abre la app en el navegador
2. Clic en el ícono de instalación en la barra de direcciones
3. O usa el botón "Instalar aplicación" en la pantalla de inicio

### Android
1. Abre en Chrome
2. Menú → "Agregar a pantalla de inicio"

### iOS (Safari)
1. Abre en Safari
2. Botón Compartir → "Agregar a pantalla de inicio"

---

## 🔧 Flujo de uso

```
Inicio → Plantilla → Datos de muestreo → Fotografías → Generar reporte
```

El sistema genera un archivo **ZIP** que contiene:
- `NombreProyecto_Fecha.tex` — Código fuente LaTeX
- `imagenes/` — Carpeta con las fotografías adjuntas
- `README.txt` — Instrucciones de compilación

### Compilar el PDF

```bash
# Con TeX Live instalado:
pdflatex NombreProyecto_Fecha.tex
pdflatex NombreProyecto_Fecha.tex  # Segunda vez para índices

# Online (sin instalar nada):
# 1. Ir a https://overleaf.com
# 2. Nuevo proyecto → Subir ZIP
```

---

## 📋 Plantillas LaTeX incluidas

| ID | Nombre | Descripción |
|----|--------|-------------|
| `aves_estandar` | Muestreo estándar | Protocolo básico de avistamiento con portada verde |
| `biodiversidad` | Monitoreo de biodiversidad | Registro multiespecies con métricas de diversidad |
| `registro_extendido` | Registro de campo extendido | Ficha técnica detallada para publicación científica |

---

## ⚙️ Características técnicas

- **Offline-first** — Service Worker con estrategia Cache-First
- **Sin dependencias de backend** — 100% cliente
- **JSZip** — Empaquetado ZIP en el navegador
- **localStorage** — Borrador guardado automáticamente
- **GPS integrado** — Captura de coordenadas via API Geolocation
- **Cámara** — Captura directa desde dispositivo móvil

---

## 📦 Dependencias externas (CDN)

```html
<!-- JSZip para generación del ZIP -->
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js"></script>

<!-- Fuentes (Crimson Pro + DM Sans) -->
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro...&family=DM+Sans..."/>
```

Ambas se cachean en el Service Worker después del primer uso.

---

## 🎨 Diseño

- **Paleta**: Verde bosque profundo (#1c3d2c), pergamino cálido (#f6f1e8), ámbar (#c8780a)
- **Tipografía**: Crimson Pro (títulos, estilo diario de campo) + DM Sans (cuerpo)
- **Estética**: Diario de expedición científica — orgánico, preciso, profesional
- **Responsive**: Funciona en móvil, tablet y escritorio

---

## 📄 Licencia

Desarrollado con AveSampler. Libre para uso científico y educativo.
