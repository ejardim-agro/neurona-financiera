import fs from "fs";
import path from "path";

const WEB_READY_DIR = path.join(__dirname, "../../../output/06_web_ready");
const NORMALIZED_DIR = path.join(__dirname, "../../../output/04_normalized");
const APP_DIR = path.join(__dirname, "../app");

// Mapeo de nombres de archivos a nombres amigables para la navegación
const chapterNames: Record<string, string> = {
  "01_aprendizaje_financiero": "Aprendizaje Financiero",
  "02_fundamentos_financieros": "Fundamentos Financieros",
  "03_mentalidad_financiera": "Mentalidad Financiera",
  "04_psicologia_financiera": "Psicología Financiera",
  "05_ahorros": "Ahorros",
  "06_gestion_de_deudas": "Gestión de Deudas",
  "07_finanzas_personales": "Finanzas Personales",
  "08_seguridad_financiera": "Seguridad Financiera",
  "09_economia": "Economía",
  "10_finanzas_del_hogar": "Finanzas del Hogar",
  "11_finanzas_familiares": "Finanzas Familiares",
  "12_finanzas_en_pareja": "Finanzas en Pareja",
  "13_analisis_financiero": "Análisis Financiero",
  "14_consumo": "Consumo",
  "15_planificacion_financiera": "Planificación Financiera",
  "16_generacion_de_ingresos": "Generación de Ingresos",
  "17_productividad_personal": "Productividad Personal",
  "18_negociacion": "Negociación",
  "19_marketing_y_ventas": "Marketing y Ventas",
  "20_negocios_y_emprendimiento": "Negocios y Emprendimiento",
  "21_inversiones": "Inversiones",
  "22_planificacion_para_la_jubilacion": "Planificación para la Jubilación",
  "23_oportunidades_financieras": "Oportunidades Financieras",
  "24_desarrollo_personal": "Desarrollo Personal",
  "25_liderazgo": "Liderazgo",
  "26_calidad_de_vida": "Calidad de Vida",
  "27_estilo_de_vida": "Estilo de Vida",
  "28_salud_y_bienestar": "Salud y Bienestar",
  "29_historias_e_inspiracion": "Historias e Inspiración",
  "30_reflexiones": "Reflexiones",
  "31_filosofia": "Filosofía",
  "32_podcasts": "Podcasts",
};

function copyFile(src: string, dest: string) {
  const destDir = path.dirname(dest);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  fs.copyFileSync(src, dest);
}

function copyDirectory(src: string, dest: string) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

// Copiar archivos principales de capítulos
console.log("Copiando archivos principales...");
const mainFiles = fs
  .readdirSync(WEB_READY_DIR)
  .filter((file) => file.endsWith(".md") && file !== "glossary.md");

for (const file of mainFiles) {
  const baseName = file.replace(".md", "");
  const chapterName = chapterNames[baseName] || baseName;
  const chapterDir = path.join(APP_DIR, "capitulos", baseName);
  if (!fs.existsSync(chapterDir)) {
    fs.mkdirSync(chapterDir, { recursive: true });
  }
  copyFile(path.join(WEB_READY_DIR, file), path.join(chapterDir, "page.mdx"));

  // Copiar subcarpetas si existen
  const subDir = path.join(WEB_READY_DIR, baseName);
  if (fs.existsSync(subDir) && fs.statSync(subDir).isDirectory()) {
    copyDirectory(subDir, path.join(chapterDir, baseName));
  }
}

// Copiar glosario
console.log("Copiando glosario...");
const glossaryDir = path.join(APP_DIR, "glosario");
if (!fs.existsSync(glossaryDir)) {
  fs.mkdirSync(glossaryDir, { recursive: true });
}
copyFile(
  path.join(WEB_READY_DIR, "glossary.md"),
  path.join(glossaryDir, "page.mdx")
);

// Copiar transcripts
console.log("Copiando transcripts...");
const transcriptsDir = path.join(APP_DIR, "transcripts");
if (!fs.existsSync(transcriptsDir)) {
  fs.mkdirSync(transcriptsDir, { recursive: true });
}

const transcriptFiles = fs
  .readdirSync(NORMALIZED_DIR)
  .filter((file) => file.endsWith(".md"));

for (const file of transcriptFiles) {
  copyFile(path.join(NORMALIZED_DIR, file), path.join(transcriptsDir, file));
}

console.log("¡Contenido copiado exitosamente!");
