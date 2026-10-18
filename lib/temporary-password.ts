// Temporary passwords are one plain Spanish word, easy to say and type: no accents,
// no ñ and at least 8 letters (the Auth minimum). The member must replace it on
// first sign-in, so it only has to survive until then.
export const TEMPORARY_PASSWORD_MIN_LENGTH = 8;

export const temporaryPasswordWords = [
  "amarillo", "arcoiris", "bicicleta", "biblioteca", "calabaza", "caracola", "caramelo", "castillo",
  "chocolate", "cocodrilo", "cuaderno", "dinosaurio", "elefante", "escalera", "estrella", "girasoles",
  "golondrina", "guitarra", "lagartija", "limonada", "manzanas", "mariposa", "melocoton", "mermelada",
  "naranjas", "palmeras", "paraguas", "pelicano", "primavera", "sandalias", "tormenta", "tortugas",
  "trompeta", "ventanas", "violetas", "flamenco",
].filter(word => word.length >= TEMPORARY_PASSWORD_MIN_LENGTH);

export function generateTemporaryPassword(random: (max: number) => number = secureRandomIndex) {
  return temporaryPasswordWords[random(temporaryPasswordWords.length)];
}

function secureRandomIndex(max: number) {
  const limit = Math.floor(0x100000000 / max) * max;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % max;
}
