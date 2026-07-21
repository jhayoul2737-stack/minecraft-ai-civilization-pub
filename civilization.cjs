const { createCitizen } = require('./citizen.cjs');

const citizens = [
  { name: 'Adam', purpose: 'Survive and build a civilization' }
];

citizens.forEach((c, i) => {
  setTimeout(() => createCitizen(c), i * 5000);
});
