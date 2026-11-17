/* Standalone Start Screen controller. The queueing workspace lives in queueing.html. */
(function () {
  'use strict';
  const ORGANIZER_STORAGE_SUFFIX = String(window.PPM_ORGANIZER_ID || '').replace(/[^a-zA-Z0-9_-]/g, '');
  const STATE_KEY = `pickleq_v11_state${ORGANIZER_STORAGE_SUFFIX ? `_${ORGANIZER_STORAGE_SUFFIX}` : ''}`;
  const LEGACY_STATE_KEYS = ORGANIZER_STORAGE_SUFFIX ? [] : ['pickleq_v10_state', 'pickleq_v9_state', 'pickleq_v8_state', 'pickleq_v7_state', 'pickleq_v6_state'];
  const SAVED_AT_KEY = `${STATE_KEY}_saved_at`;
  const PENDING_SYNC_KEY = `${STATE_KEY}_pending_sync`;
  const PENDING_START_CONFIG_KEY = 'picklepoint.pending-live-queue-start-config';
  const $ = id => document.getElementById(id);

  let currentState = null;
  let sharedStateRevision = 0;
  let stateCheckComplete = false;
  let isNavigating = false;
  let sharedStateSource = null;
  let locationSuggestTimer = 0;
  let locationSuggestController = null;
  let locationSuggestRequestId = 0;
  let locationSuggestFeatures = [];
  let locationSuggestActiveIndex = -1;
  let locationSuggestLastRequestAt = 0;

  const PH_LOCATION_BOUNDS = { minLat: 4.0, maxLat: 22.4, minLon: 115.5, maxLon: 128.6 };
  const PH_LOCATION_CENTER = { lat: 12.8797, lon: 121.7740 };
  // Verified court entries are included alongside the live Philippines geocoder
  // so venues that are not yet indexed in OpenStreetMap can still be selected.
            const VERIFIED_PH_COURT_LOCATIONS = [
      {
        name: 'Summer Pickle and Perks (Alabel)',
        address: 'Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
        label: 'Summer Pickle and Perks, Pecolados Compound, Purok Centro, Poblacion, Alabel, Sarangani 9501, Philippines',
        lat: 6.1114236,
        lon: 125.2934115,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1114236,125.2934115',
        placeId: 'venue:summer-pickle-and-perks-alabel'
      },
      {
        name: 'Summer Pickle and Perks-Bula',
        address: 'Zone 9, Bula, General Santos City, South Cotabato, Philippines',
        label: 'Summer Pickle and Perks-Bula, Zone 9, Bula, General Santos City, South Cotabato, Philippines',
        lat: 6.106678009,
        lon: 125.192527771,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.106678009,125.192527771',
        placeId: 'venue:summer-pickle-and-perks-bula'
      },
      {
        name: 'Pickle World Gensan - Downtown',
        address: 'NCCC Compound, National Highway, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
        label: 'Pickle World Gensan - Downtown, NCCC Compound, National Highway, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
        lat: 6.121556,
        lon: 125.1754212,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79ffa312fcc13:0x530972c55c9f7c3b',
        mapsUrl: 'https://maps.app.goo.gl/i2oK4WniREN33NAv7'
      },
      {
        name: 'Pickle World Gensan - Lagao',
        address: '114L, Purok 12 Arradaza St, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
        label: 'Pickle World Gensan - Lagao, 114L, Purok 12 Arradaza St, General Santos City (Dadiangas), 9500 South Cotabato, Philippines',
        lat: 6.1187434,
        lon: 125.2048218,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79fcbfb8ef755:0x9f1ebf6d818c1463',
        mapsUrl: 'https://maps.app.goo.gl/3U1eqL1KNjto2i1BA'
      },
      {
        name: "965 Pickleball Court",
        address: "Barangay Conel, General Santos City, South Cotabato, Philippines",
        label: "965 Pickleball Court, Barangay Conel, General Santos City, South Cotabato, Philippines",
        lat: 6.1926129,
        lon: 125.1603689,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79d00738e2791:0xfc636a0255966313',
        mapsUrl: 'https://maps.app.goo.gl/FCgyGVzSB4tPWtyu6'
      },
      {
        name: "AFA Paddle & Events Place",
        address: "NLSA Extension, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
        label: "AFA Paddle & Events Place, NLSA Extension, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
        lat: 6.155658,
        lon: 125.157001,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.155658,125.157001'
      },
      {
        name: "Altori Park Pickleball",
        address: "Matatag Park Square, Nuñez Extension Street, General Santos City, South Cotabato, Philippines",
        label: "Altori Park Pickleball, Matatag Park Square, Nuñez Extension Street, General Santos City, South Cotabato, Philippines",
        lat: 6.139041,
        lon: 125.156759,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.139041,125.156759'
      },
      {
        name: "Bayview Pickleball Court",
        address: "Zone 8, Upper Banualan, Barangay Tambler, General Santos City, South Cotabato, Philippines",
        label: "Bayview Pickleball Court, Zone 8, Upper Banualan, Barangay Tambler, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Brigada Golf Range",
        address: "Brigada Business Hub, National Highway, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
        label: "Brigada Golf Range, Brigada Business Hub, National Highway, Barangay Mabuhay, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Cabin Pickle Club",
        address: "Diversion Road, Barangay Apopong, The Cabin Brewery, General Santos City, South Cotabato, Philippines",
        label: "Cabin Pickle Club, Diversion Road, Barangay Apopong, The Cabin Brewery, General Santos City, South Cotabato, Philippines",
        lat: 6.1014193,
        lon: 125.1056464,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f7995021542b5f:0x251e594250baa8bd',
        mapsUrl: 'https://maps.app.goo.gl/gUMpR2Pi1fxcDYSX9'
      },
      {
        name: "CCM Pickleball Court",
        address: "CCM Sports Center, Purok Masagana, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "CCM Pickleball Court, CCM Sports Center, Purok Masagana, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.153997,
        lon: 125.165505,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.153997,125.165505'
      },
      {
        name: "Central PickleHub",
        address: "Manansala Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
        label: "Central PickleHub, Manansala Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
        lat: 6.1177125,
        lon: 125.1677942,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://maps.app.goo.gl/YesBChcUndWDdpU19'
      },
      {
        name: "City Smash Pickleball",
        address: "PG Building, National Highway, Queens Love Village, General Santos City, South Cotabato, Philippines",
        label: "City Smash Pickleball, PG Building, National Highway, Queens Love Village, General Santos City, South Cotabato, Philippines",
        lat: 6.11925,
        lon: 125.17311,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.11925,125.17311'
      },
      {
        name: "Conel Courts Pickle and Brew",
        address: "Purok 1B, Santos Compound, Barangay Conel, General Santos City, South Cotabato, Philippines",
        label: "Conel Courts Pickle and Brew, Purok 1B, Santos Compound, Barangay Conel, General Santos City, South Cotabato, Philippines",
        lat: 6.202036,
        lon: 125.1913919,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79d5b00c3cb07:0xca57c964e897db52',
        mapsUrl: 'https://maps.app.goo.gl/ZZGukqXUMLqj2BSW8'
      },
      {
        name: "Court Zero Racquet Club",
        address: "Sampaguita Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
        label: "Court Zero Racquet Club, Sampaguita Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
        lat: 6.1265535,
        lon: 125.1692548,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1265535,125.1692548'
      },
      {
        name: "D'Lotte Picklepark",
        address: "44QW+5H6, Nuñez Street, Purok Riverside, General Santos City, South Cotabato, Philippines",
        label: "D'Lotte Picklepark, 44QW+5H6, Nuñez Street, Purok Riverside, General Santos City, South Cotabato, Philippines",
        lat: 6.1379025,
        lon: 125.14637890625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1379025,125.14637890625'
      },
      {
        name: "Dink O'Clock",
        address: "Big Wide, National Highway, Palen, Barangay Labangal, General Santos City, South Cotabato, Philippines",
        label: "Dink O'Clock, Big Wide, National Highway, Palen, Barangay Labangal, General Santos City, South Cotabato, Philippines",
        lat: 6.1184025,
        lon: 125.15416015625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1184025,125.15416015625'
      },
      {
        name: "Dinkwondo",
        address: "NLSA Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "Dinkwondo, NLSA Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.1330625,
        lon: 125.1849375,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f78e3b51ad3:0x3c8131512958b7e0',
        mapsUrl: 'https://maps.app.goo.gl/knc8wHTtfVqWfEKW6'
      },
      {
        name: "Frasssati Outdoor Recreation Area (FORA)",
        address: "Our Lady Manaog Compound, Nuñez Street, General Santos City, South Cotabato, Philippines",
        label: "Frasssati Outdoor Recreation Area (FORA), Our Lady Manaog Compound, Nuñez Street, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "FRNDZONE Playhub",
        address: "Purok Ricvill, San Jose, near General Santos Airport, General Santos City, South Cotabato, Philippines",
        label: "FRNDZONE Playhub, Purok Ricvill, San Jose, near General Santos Airport, General Santos City, South Cotabato, Philippines",
        lat: 6.0799663,
        lon: 125.0856893,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f7a38886b31997:0x9cd39d23155e9a79',
        mapsUrl: 'https://maps.app.goo.gl/133whi3br3dRnUZk9'
      },
      {
        name: "Game Yard",
        address: "Purok Amadeo, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "Game Yard, Purok Amadeo, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.136615,
        lon: 125.1843838,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79ffd6b407bbb:0x426ab1e8ad1acaef',
        mapsUrl: 'https://maps.app.goo.gl/tFvJpUeVwXwjkLaXA'
      },
      {
        name: "Game-On Picklehaus",
        address: "National Highway, General Santos City, South Cotabato, Philippines",
        label: "Game-On Picklehaus, National Highway, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Gensan Rackets Pickleball Club",
        address: "Nursery Road, near EmJake Aquawave, General Santos City, South Cotabato, Philippines",
        label: "Gensan Rackets Pickleball Club, Nursery Road, near EmJake Aquawave, General Santos City, South Cotabato, Philippines",
        lat: 6.144005,
        lon: 125.1932769,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f003b725e2b:0x579b49a5b16cc6b8',
        mapsUrl: 'https://maps.app.goo.gl/n2rLaDc14oLnfzgn9'
      },
      {
        name: "Gmall Pickleball Gensan",
        address: "Gaisano Mall, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        label: "Gmall Pickleball Gensan, Gaisano Mall, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        lat: 6.1183134,
        lon: 125.1845544,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79fb078fccdab:0x99982f61dbc955e9',
        mapsUrl: 'https://maps.app.goo.gl/YZ7vCmUtkmo2uacG9'
      },
      {
        name: "J&P Pickleball Academy",
        address: "45VH+PGR, Pancubila Street, General Santos City, South Cotabato, Philippines",
        label: "J&P Pickleball Academy, 45VH+PGR, Pancubila Street, General Santos City, South Cotabato, Philippines",
        lat: 6.1443525,
        lon: 125.17875390625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1443525,125.17875390625'
      },
      {
        name: "JCO Pickleball Hub",
        address: "46R5+FJR, Davao Road, Lagao, beside VSM Estate, General Santos City, South Cotabato, Philippines",
        label: "JCO Pickleball Hub, 46R5+FJR, Davao Road, Lagao, beside VSM Estate, General Santos City, South Cotabato, Philippines",
        lat: 6.1412275,
        lon: 125.20900390625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1412275,125.20900390625'
      },
      {
        name: "JG Oranza Sports Arena",
        address: "Buayan, General Santos City, South Cotabato, Philippines",
        label: "JG Oranza Sports Arena, Buayan, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Laureto Pickleball Court",
        address: "44QW+4MR, Nuñez Street, General Santos City, South Cotabato, Philippines",
        label: "Laureto Pickleball Court, 44QW+4MR, Nuñez Street, General Santos City, South Cotabato, Philippines",
        lat: 6.1378525,
        lon: 125.14662890625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1378525,125.14662890625'
      },
      {
        name: "Lim Spring Garden",
        address: "Near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
        label: "Lim Spring Garden, Near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
        lat: 6.1296466,
        lon: 125.1971456,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f00008990e3:0x2203e1d9ca535f51',
        mapsUrl: 'https://maps.app.goo.gl/E9LEPzc89yrsLkB9A'
      },
      {
        name: "LPS Homecourt",
        address: "Fil-Am Road, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
        label: "LPS Homecourt, Fil-Am Road, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
        lat: 6.0718022,
        lon: 125.1345484,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f7a100608cffb7:0x368e6dd81ffebb80',
        mapsUrl: 'https://maps.app.goo.gl/JcRmkEGerEz8uzSn9'
      },
      {
        name: "Mamikilay",
        address: "Lower Cabuay Road, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
        label: "Mamikilay, Lower Cabuay Road, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
        lat: 6.1406545,
        lon: 125.1127992,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f799005c95f7a1:0x405b75587d671514',
        mapsUrl: 'https://maps.app.goo.gl/P4wZLTpFNFDp41p28'
      },
      {
        name: "NRT Events Center",
        address: "Purok Cañas, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "NRT Events Center, Purok Cañas, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.16112,
        lon: 125.167273,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f0a7dae8fff:0x7cece8854e054ecf',
        mapsUrl: 'https://maps.app.goo.gl/FXhF1UMMhe4HNMeG9'
      },
      {
        name: "Paddle King Court",
        address: "MC Village, Block 3, Barangay Fatima, General Santos City, South Cotabato, Philippines",
        label: "Paddle King Court, MC Village, Block 3, Barangay Fatima, General Santos City, South Cotabato, Philippines",
        lat: 6.071332,
        lon: 125.1049725,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f7a3003b360a19:0x5714df713af06d75',
        mapsUrl: 'https://maps.app.goo.gl/pkbQEafHmRQacJDu8'
      },
      {
        name: "Pickle Barn",
        address: "Upper Villegas, beside Imperial Bodega, General Santos City, South Cotabato, Philippines",
        label: "Pickle Barn, Upper Villegas, beside Imperial Bodega, General Santos City, South Cotabato, Philippines",
        lat: 6.1431454,
        lon: 125.1741914,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f07cdfc0831:0xc59a7ab7af150b84',
        mapsUrl: 'https://maps.app.goo.gl/uDNzGxhK6ERNzHrn7'
      },
      {
        name: "Pickle Bull by Kwiky Mart",
        address: "National Highway, General Santos City, South Cotabato, Philippines",
        label: "Pickle Bull by Kwiky Mart, National Highway, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Pickle Court Co.",
        address: "Golden Village, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "Pickle Court Co., Golden Village, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Pickle Panic Recreational Park",
        address: "Lagare Farms & Parks, General Santos City, South Cotabato, Philippines",
        label: "Pickle Panic Recreational Park, Lagare Farms & Parks, General Santos City, South Cotabato, Philippines",
        lat: 6.131262,
        lon: 125.149036,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f13956fcd9b:0x30c3dc62dbe93cf5',
        mapsUrl: 'https://maps.app.goo.gl/T3Wn9TvPYwyN5JXP8'
      },
      {
        name: "Pickleholics",
        address: "Purok Soriano, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
        label: "Pickleholics, Purok Soriano, Barangay Sinawal, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Picklehub & Cafe",
        address: "Velasquez Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
        label: "Picklehub & Cafe, Velasquez Street, Dadiangas North, General Santos City, South Cotabato, Philippines",
        lat: 6.118462563,
        lon: 125.165641785,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.118462563,125.165641785'
      },
      {
        name: "Picklepals – SM City GenSan",
        address: "Parking Lot E, SM City General Santos, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        label: "Picklepals – SM City GenSan, Parking Lot E, SM City General Santos, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Pickleyard & Co",
        address: "Fernandez Street, near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
        label: "Pickleyard & Co, Fernandez Street, near Lagao Barangay Hall, General Santos City, South Cotabato, Philippines",
        lat: 6.1235625,
        lon: 125.1845625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1235625,125.1845625'
      },
      {
        name: "Rally Point GenSan (RPG-GUPC) Pickleball Courts",
        address: "45CM+6J5, behind GSIS Office, National Highway, General Santos City, South Cotabato, Philippines",
        label: "Rally Point GenSan (RPG-GUPC) Pickleball Courts, 45CM+6J5, behind GSIS Office, National Highway, General Santos City, South Cotabato, Philippines",
        lat: 6.1205169,
        lon: 125.1841202,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f0012e2b089:0x35bff7fe44048df2',
        mapsUrl: 'https://maps.app.goo.gl/LsqVfPhH8BdnHfS27'
      },
      {
        name: "RAPIKOL Pickleball Court",
        address: "Odi Street, General Santos City, South Cotabato, Philippines",
        label: "RAPIKOL Pickleball Court, Odi Street, General Santos City, South Cotabato, Philippines",
        lat: 6.1294375,
        lon: 125.1933125,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1294375,125.1933125'
      },
      {
        name: "RGR Pickleball Courtside",
        address: "Pancubila Street, General Santos City, South Cotabato, Philippines",
        label: "RGR Pickleball Courtside, Pancubila Street, General Santos City, South Cotabato, Philippines",
        lat: 6.1457025,
        lon: 125.17841015625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1457025,125.17841015625'
      },
      {
        name: "Robinson Pickleball",
        address: "Robinsons Place GenSan, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        label: "Robinson Pickleball, Robinsons Place GenSan, J. Catolico Sr. Avenue, General Santos City, South Cotabato, Philippines",
        lat: 6.1202669,
        lon: 125.1897059,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f000f19fa1f:0x4ea148efa1bfdb7d',
        mapsUrl: 'https://maps.app.goo.gl/C2J2Fth5ZbtQd1gX7'
      },
      {
        name: "Sanman Pickle Punch GenSan",
        address: "Sanman Boxing Gym Compound, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "Sanman Pickle Punch GenSan, Sanman Boxing Gym Compound, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.138551,
        lon: 125.1803825,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f9c72b79b19:0x88c31ee2fcca06de',
        mapsUrl: 'https://maps.app.goo.gl/hhxMtkQqs3rmMHbd8'
      },
      {
        name: "Serve & Volley Pickleball Courts",
        address: "Mabuhay Road, General Santos City, South Cotabato, Philippines",
        label: "Serve & Volley Pickleball Courts, Mabuhay Road, General Santos City, South Cotabato, Philippines",
        lat: 6.1449375,
        lon: 125.1605625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1449375,125.1605625'
      },
      {
        name: "SideOut GenSan – Exclusive",
        address: "Solomon Subdivision, Purok 15, Lagao, General Santos City, South Cotabato, Philippines",
        label: "SideOut GenSan – Exclusive, Solomon Subdivision, Purok 15, Lagao, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "SideOut Pickleball Court GenSan – Main",
        address: "National Highway, Lagao, opposite La Mirada Inn, General Santos City, South Cotabato, Philippines",
        label: "SideOut Pickleball Court GenSan – Main, National Highway, Lagao, opposite La Mirada Inn, General Santos City, South Cotabato, Philippines",
        lat: 6.131947517,
        lon: 125.201087952,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.131947517,125.201087952'
      },
      {
        name: "T-James Sporty Bar",
        address: "Purok 14-D, Katangawan, General Santos City, South Cotabato, Philippines",
        label: "T-James Sporty Bar, Purok 14-D, Katangawan, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "The Compound Courts",
        address: "5568+6WR, General Santos City Circumferential Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        label: "The Compound Courts, 5568+6WR, General Santos City Circumferential Road, Barangay San Isidro, General Santos City, South Cotabato, Philippines",
        lat: 6.1606025,
        lon: 125.16725390625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1606025,125.16725390625'
      },
      {
        name: "The Loom & The Leaf Weekend Market",
        address: "Nopo-Conel, Mabuhay Road, General Santos City, South Cotabato, Philippines",
        label: "The Loom & The Leaf Weekend Market, Nopo-Conel, Mabuhay Road, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "The Paddle Club Pickleball",
        address: "Tiongson Street, Lagao, General Santos City, South Cotabato, Philippines",
        label: "The Paddle Club Pickleball, Tiongson Street, Lagao, General Santos City, South Cotabato, Philippines",
        lat: 6.1272035,
        lon: 125.192598,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f0077b50255:0xa504247b5cbf36ae',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1271875,125.1925625'
      },
      {
        name: "The Palm Court",
        address: "Del Carmen Street, Lagao, General Santos City, South Cotabato, Philippines",
        label: "The Palm Court, Del Carmen Street, Lagao, General Santos City, South Cotabato, Philippines",
        lat: 6.131737232,
        lon: 125.189704895,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.131737232,125.189704895'
      },
      {
        name: "The Pickle Cafe",
        address: "Purok 3, Labu, Katangawan, General Santos City, South Cotabato, Philippines",
        label: "The Pickle Cafe, Purok 3, Labu, Katangawan, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "The Pickle Neighbour",
        address: "Romana Estate, Dacera Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
        label: "The Pickle Neighbour, Romana Estate, Dacera Street, Barangay City Heights, General Santos City, South Cotabato, Philippines",
        lat: 6.1243525,
        lon: 125.15603515625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1243525,125.15603515625'
      },
      {
        name: "Third Shot Pickleground Gensan",
        address: "Sunshine Compound, Arradaza Street, Lagao, General Santos City, South Cotabato, Philippines",
        label: "Third Shot Pickleground Gensan, Sunshine Compound, Arradaza Street, Lagao, General Santos City, South Cotabato, Philippines",
        lat: 6.1173896,
        lon: 125.1937748,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f0011f697bf:0x9884c43134ddb9cf',
        mapsUrl: 'https://maps.app.goo.gl/FxksNtumf1rp1Nvz6'
      },
      {
        name: "Tranquil Bounce Pickleball Club",
        address: "Greenfield Residences, Nursery Road, Lagao, General Santos City, South Cotabato, Philippines",
        label: "Tranquil Bounce Pickleball Club, Greenfield Residences, Nursery Road, Lagao, General Santos City, South Cotabato, Philippines",
        lat: 6.1438433,
        lon: 125.2027057,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79fc4204c719d:0x23387cdeecc58f81',
        mapsUrl: 'https://maps.app.goo.gl/LvKprZ9k6M7SQ4Ff9'
      },
      {
        name: "Triangle Centre Court",
        address: "Bula, General Santos City, South Cotabato, Philippines",
        label: "Triangle Centre Court, Bula, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "V-Park",
        address: "Circumferential Road, Velayo Farm, General Santos City, South Cotabato, Philippines",
        label: "V-Park, Circumferential Road, Velayo Farm, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Verde Pickle Courts",
        address: "Purok Maunlad Phase 2, General Santos City, South Cotabato, Philippines",
        label: "Verde Pickle Courts, Purok Maunlad Phase 2, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "ZZ Pickle Court",
        address: "Dadiangas Heights Subdivision, Block 6, General Santos City, South Cotabato, Philippines",
        label: "ZZ Pickle Court, Dadiangas Heights Subdivision, Block 6, General Santos City, South Cotabato, Philippines",
        lat: 6.1258314,
        lon: 125.174884,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        placeId: 'google:0x32f79f7e1143e47b:0xb16c43e998c7c238',
        mapsUrl: 'https://maps.app.goo.gl/QfpTRyEofVtriTuo8'
      },
      {
        name: "4th Road Picklehub & Cafe",
        address: "35H3+J56, Fourth Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "4th Road Picklehub & Cafe, 35H3+J56, Fourth Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.0790275,
        lon: 125.15287890625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.0790275,125.15287890625',
        status: "coming-soon"
      },
      {
        name: "Cross Court Gensan",
        address: "Mercado Street, Barangay San Isidro, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "Cross Court Gensan, Mercado Street, Barangay San Isidro, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.1488376,
        lon: 125.16542,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1488376,125.16542'
      },
      {
        name: "SHAO Pickle Court",
        address: "Zone 1, Barangay Buayan Townsite, General Santos City, South Cotabato, Philippines",
        label: "SHAO Pickle Court, Zone 1, Barangay Buayan Townsite, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Picklepals - San Miguel",
        address: "San Miguel Street, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
        label: "Picklepals - San Miguel, San Miguel Street, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
        lat: 6.1163125,
        lon: 125.1833125,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1163125,125.1833125'
      },
      {
        name: "RALLÉ Sports Center",
        address: "543W+JRH, General Santos City Circumferential Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "RALLÉ Sports Center, 543W+JRH, General Santos City Circumferential Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.1540525,
        lon: 125.14709765625,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1540525,125.14709765625',
        status: "coming-soon"
      },
      {
        name: "The Pickle Field",
        address: "Purok 28, Barangay San Jose Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "The Pickle Field, Purok 28, Barangay San Jose Road, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.0781555,
        lon: 125.10362,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.0781555,125.10362'
      },
      {
        name: "PickleBelle",
        address: "Savemore, Nuñez Street, Purok Malakas, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "PickleBelle, Savemore, Nuñez Street, Purok Malakas, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.138061047,
        lon: 125.1614151,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.138061047,125.1614151'
      },
      {
        name: "The Pickle Yard",
        address: "Catalino Cabe Street, Bula, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "The Pickle Yard, Catalino Cabe Street, Bula, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.111452,
        lon: 125.18355,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.111452,125.18355'
      },
      {
        name: "The Dirty Kitchen Pickleball Court",
        address: "Mabuhay Road, Agan Homes, Phase 1, Purok Perez, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
        label: "The Dirty Kitchen Pickleball Court, Mabuhay Road, Agan Homes, Phase 1, Purok Perez, General Santos City (Dadiangas), 9500 South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Dink Yard Gensan Inc",
        address: "Purok Bagong Silang, Upper Molok Bridge, National Highway, Barangay Labangal, General Santos City, South Cotabato, Philippines",
        label: "Dink Yard Gensan Inc, Purok Bagong Silang, Upper Molok Bridge, National Highway, Barangay Labangal, General Santos City, South Cotabato, Philippines",
        lat: 6.1019683,
        lon: 125.1518,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1019683,125.1518'
      },
      {
        name: "PaddlePals Recreational Hub",
        address: "Yumang Extension, General Santos City, South Cotabato, Philippines",
        label: "PaddlePals Recreational Hub, Yumang Extension, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "PogzGen Pickleball Court",
        address: "Phase 3, Block 7, Lot 24, Galatians Street, Purok Placida, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
        label: "PogzGen Pickleball Court, Phase 3, Block 7, Lot 24, Galatians Street, Purok Placida, Barangay Calumpang, General Santos City, South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Pikolbol Couples",
        address: "Block 7, Purok 3, Barangay Conel, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        label: "Pikolbol Couples, Block 7, Purok 3, Barangay Conel, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Vast Grounds - Pickleball Hub",
        address: "JFR Commercial Complex Leasing, Purok 24, Mabuhay Road, Barangay Mabuhay, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        label: "Vast Grounds - Pickleball Hub, JFR Commercial Complex Leasing, Purok 24, Mabuhay Road, Barangay Mabuhay, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        lat: 6.1524506,
        lon: 125.16048,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1524506,125.16048'
      },
      {
        name: "P16 Dink Yard",
        address: "Purok 16, Block 1, Barangay Fatima, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        label: "P16 Dink Yard, Purok 16, Block 1, Barangay Fatima, General Santos City (Dadiangas), South Cotabato, 9500, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      },
      {
        name: "Gensan Commandos Sports Center",
        address: "Purok Pantay-Pantay, Barangay Baluan, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "Gensan Commandos Sports Center, Purok Pantay-Pantay, Barangay Baluan, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: 6.1269625,
        lon: 125.21873437500001,
        countrycode: 'PH',
        source: 'verified-venue-listing',
        mapsUrl: 'https://www.google.com/maps/search/?api=1&query=6.1269625,125.21873437500001'
      },
      {
        name: "Pickle Vista",
        address: "Purok Vista, Alilaya Village, Barangay Sinawal, General Santos City (Dadiangas), South Cotabato, Philippines",
        label: "Pickle Vista, Purok Vista, Alilaya Village, Barangay Sinawal, General Santos City (Dadiangas), South Cotabato, Philippines",
        lat: null,
        lon: null,
        countrycode: 'PH',
        source: 'gensan-court-directory'
      }
    ];

  function readLocalState() {
    for (const key of [STATE_KEY, ...LEGACY_STATE_KEYS]) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) {}
    }
    return null;
  }

  function sessionId(state) { return String(state && state.sessionId || '').trim(); }

  function sessionIdentityDiffers(a, b) {
    const first = sessionId(a);
    const second = sessionId(b);
    return (!!first || !!second) && first !== second;
  }

  function isEndedSession(state) {
    return !!(state && state.sessionActive === false && state.sessionEndedAt);
  }

  function persistRemoteState(state, updatedAt) {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(state));
      const timestamp = Date.parse(updatedAt || '') || Date.now();
      localStorage.setItem(SAVED_AT_KEY, String(timestamp));
      localStorage.removeItem(PENDING_SYNC_KEY);
    } catch (_) {}
  }

  function readLocalPendingIsNewer(remoteUpdatedAt) {
    try {
      const savedAt = Number(localStorage.getItem(SAVED_AT_KEY)) || 0;
      const pendingAt = Number(localStorage.getItem(PENDING_SYNC_KEY)) || 0;
      const remoteAt = Date.parse(remoteUpdatedAt || '') || 0;
      return pendingAt > 0 && pendingAt === savedAt && savedAt > remoteAt;
    } catch (_) {
      return false;
    }
  }

  function hasExistingQueue(state) {
    if (!state || typeof state !== 'object') return false;
    if (isEndedSession(state)) return false;
    return !!(state.sessionActive ||
      (Array.isArray(state.players) && state.players.length) ||
      (Array.isArray(state.left) && state.left.length) ||
      (Array.isArray(state.queue) && state.queue.length) ||
      (Array.isArray(state.courts) && state.courts.length) ||
      (Array.isArray(state.logs) && state.logs.length));
  }

  function getPrefix(dupr) {
    return dupr ? '(DUPR MATCH)' : '(NON DUPR MATCH)';
  }

  function escapeSessionNamePreviewText(value) {
    return String(value).replace(/[&<>\"']/g, character => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;'
    }[character]));
  }

  function renderSessionNamePreview() {
    const input = $('liveQueueSessionName');
    const preview = $('liveQueueSessionNamePreview');
    if (!input || !preview) return;

    const value = String(input.value || '');
    const match = value.match(/^(\s*)(\((?:NON\s+)?DUPR\s+(?:RATED|MATCH)\))/i);
    const content = match
      ? `${escapeSessionNamePreviewText(match[1])}<span class="live-queue-session-name-prefix">${escapeSessionNamePreviewText(match[2])}</span>${escapeSessionNamePreviewText(value.slice(match[0].length))}`
      : escapeSessionNamePreviewText(value);
    preview.innerHTML = `<span class="live-queue-session-name-preview-content">${content}</span>`;

    const inputStyle = window.getComputedStyle(input);
    preview.style.font = inputStyle.font;
    preview.style.letterSpacing = inputStyle.letterSpacing;
    preview.style.textTransform = inputStyle.textTransform;
    preview.style.color = "#18383e";
    preview.style.paddingLeft = inputStyle.paddingLeft;
    preview.style.paddingRight = inputStyle.paddingRight;
    const previewContent = preview.firstElementChild;
    if (previewContent) previewContent.style.transform = `translateX(${-input.scrollLeft}px)`;
  }

  function syncSessionName() {
    const input = $('liveQueueSessionName');
    if (!input) return;
    const prefix = getPrefix(!!$('liveQueueDupr')?.checked);
    const current = String(input.value || '').trim();
    const suffix = current.replace(/^\((?:NON )?DUPR MATCH\)\s*/i, '').trim();
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const autoName = !suffix || /^Open Play(?:\s*[—-]\s*[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})?$/i.test(suffix);
    const nextSuffix = autoName ? `Open Play — ${today}` : suffix;
    input.value = `${prefix} ${nextSuffix}`;
    input.dataset.lastValidSuffix = nextSuffix;
    renderSessionNamePreview();
  }

  function enforceSessionPrefix() {
    const input = $('liveQueueSessionName');
    if (!input) return;
    const prefix = `${getPrefix(!!$('liveQueueDupr')?.checked)} `;
    const raw = String(input.value || '');
    let suffix = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw.replace(/^\s*\([^)]*\)\s*/, '');
    suffix = suffix.replace(/\s*\((?:NON )?DUPR MATCH\)\s*/ig, ' ').replace(/^\s+/, '');
    const next = suffix ? `${prefix}${suffix}` : prefix;
    if (raw !== next) {
      const oldStart = input.selectionStart ?? raw.length;
      input.value = next;
      try {
        const caret = Math.max(prefix.length, Math.min(next.length, oldStart));
        input.setSelectionRange(caret, caret);
      } catch (_) {}
    }
    input.dataset.lastValidSuffix = suffix || input.dataset.lastValidSuffix || 'Open Play';
    renderSessionNamePreview();
  }

  function setGroupActive(selector, button) {
    document.querySelectorAll(selector).forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
  }

  function normalizeSelectedLocationCoordinates(value) {
    let source = value;
    if (typeof source === 'string') {
      try { source = JSON.parse(source); } catch (_) { return null; }
    }
    if (!source || typeof source !== 'object') return null;
    const lat = Number(source.lat ?? source.latitude);
    const lon = Number(source.lon ?? source.lng ?? source.longitude);
    const insidePhilippines = Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= PH_LOCATION_BOUNDS.minLat && lat <= PH_LOCATION_BOUNDS.maxLat &&
      lon >= PH_LOCATION_BOUNDS.minLon && lon <= PH_LOCATION_BOUNDS.maxLon;
    if (!insidePhilippines) return null;
    const countrycode = String(source.countrycode || source.countryCode || 'PH').toUpperCase();
    if (countrycode !== 'PH') return null;
    return {
      lat,
      lon,
      label: String(source.label || source.name || '').trim(),
      name: String(source.name || '').trim(),
      countrycode: 'PH',
      source: String(source.source || 'photon')
    };
  }

  function getSelectedLocationCoordinates() {
    return normalizeSelectedLocationCoordinates($('liveQueueDuprLocationCoordinates')?.value || '');
  }

  function setSelectedLocationCoordinates(value) {
    const hidden = $('liveQueueDuprLocationCoordinates');
    if (!hidden) return;
    const normalized = normalizeSelectedLocationCoordinates(value);
    hidden.value = normalized ? JSON.stringify(normalized) : '';
  }

  function hideLocationSuggestions() {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (list) {
      list.hidden = true;
      list.innerHTML = '';
    }
    if (input) input.setAttribute('aria-expanded', 'false');
    locationSuggestFeatures = [];
    locationSuggestActiveIndex = -1;
  }

  function showLocationMessage(title, message) {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (!list || !input) return;
    list.innerHTML = `<div class="live-queue-location-message"><strong>${escapeLocationText(title)}</strong>${escapeLocationText(message)}</div>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    locationSuggestFeatures = [];
    locationSuggestActiveIndex = -1;
  }

  function escapeLocationText(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  }

  function normalizeLocationSearchText(value) {
    return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function locationFeatureParts(feature) {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.coordinates || [];
    const lon = Number(coordinates[0]);
    const lat = Number(coordinates[1]);
    const countrycode = String(properties.countrycode || properties.countryCode || '').toUpperCase();
    if (countrycode !== 'PH' || !Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < PH_LOCATION_BOUNDS.minLat || lat > PH_LOCATION_BOUNDS.maxLat ||
        lon < PH_LOCATION_BOUNDS.minLon || lon > PH_LOCATION_BOUNDS.maxLon) return null;

    const name = String(properties.name || properties.street || properties.city || 'Philippines location').trim();
    const street = [properties.housenumber, properties.street].filter(Boolean).join(' ').trim();
    const addressParts = [
      street && normalizeLocationSearchText(street) !== normalizeLocationSearchText(name) ? street : '',
      properties.district,
      properties.suburb,
      properties.city,
      properties.county,
      properties.state,
      properties.postcode,
      'Philippines'
    ].filter(Boolean);
    const address = [...new Set(addressParts.map(value => String(value).trim()).filter(Boolean))].join(', ');
    const label = [...new Set([name, ...addressParts].filter(Boolean))].join(', ');
    const osmId = [properties.osm_type || '', properties.osm_id || ''].join(':');
    return { name, address, label, lat, lon, countrycode: 'PH', osmId, properties };
  }

  function renderLocationSuggestions(features) {
    const list = $('liveQueueDuprLocationSuggestions');
    const input = $('liveQueueDuprLocation');
    if (!list || !input) return;
    locationSuggestFeatures = features;
    locationSuggestActiveIndex = -1;
    if (!features.length) {
      showLocationMessage('No matching Philippines location', 'Try the venue name with its city, barangay, or province. You can also enter a full address manually.');
      return;
    }
    list.innerHTML = features.map((feature, index) => `
      <button type="button" class="live-queue-location-option" role="option" aria-selected="false" data-location-option="${index}">
        <strong>${escapeLocationText(feature.name)}</strong>
        <small>${escapeLocationText(feature.address || feature.label)}</small>
        <em>${feature.status === 'coming-soon' ? 'Coming soon · ' : ''}${feature.source === 'gensan-court-directory' ? 'GenSan court directory · location listing' : feature.source === 'verified-venue-listing' ? 'Verified court venue · Philippines' : 'Philippines · Map search'}</em>
      </button>`).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  async function searchPhilippinesLocations(query, requestId) {
    const input = $('liveQueueDuprLocation');
    if (!input || input.disabled) return;
    if (locationSuggestController) locationSuggestController.abort();
    const controller = new AbortController();
    locationSuggestController = controller;
    const delay = Math.max(0, 950 - (Date.now() - locationSuggestLastRequestAt));
    if (delay) await new Promise(resolve => window.setTimeout(resolve, delay));
    if (controller.signal.aborted || requestId !== locationSuggestRequestId || String(input.value || '').trim() !== query) return;

    const terms = normalizeLocationSearchText(query).split(' ').filter(term => term.length > 2 && !['the', 'and', 'for', 'philippines', 'pickleball', 'court', 'courts', 'venue', 'venues', 'club', 'clubs'].includes(term));
    const requiredMatches = terms.length <= 1 ? 1 : Math.max(1, Math.ceil(terms.length * 0.5));
    const curatedMatches = terms.length ? VERIFIED_PH_COURT_LOCATIONS.filter(feature => {
      const searchable = normalizeLocationSearchText(`${feature.name} ${feature.address} ${/general\s+santos/i.test(feature.address) ? 'GenSan' : ''}`);
      const matches = terms.filter(term => searchable.includes(term)).length;
      return matches >= requiredMatches;
    }).map(feature => ({ ...feature })) : [];
    if (curatedMatches.length) renderLocationSuggestions(curatedMatches);
    else showLocationMessage('Searching Philippines locations…', 'Looking for matching courts, venues, and addresses.');
    const params = new URLSearchParams({
      q: query,
      limit: '10',
      lang: 'en',
      countrycode: 'PH',
      bbox: '115.5,4.0,128.6,22.4',
      lat: String(PH_LOCATION_CENTER.lat),
      lon: String(PH_LOCATION_CENTER.lon),
      zoom: '5'
    });
    locationSuggestLastRequestAt = Date.now();
    try {
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
        headers: { Accept: 'application/geo+json, application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`Location search failed (${response.status}).`);
      const payload = await response.json();
      if (controller.signal.aborted || requestId !== locationSuggestRequestId || String(input.value || '').trim() !== query) return;

      const unique = new Map();
      // Add verified Philippine pickleball venues first when the search matches.
      curatedMatches.forEach(feature => {
        const lat = Number(feature.lat);
        const lon = Number(feature.lon);
        const hasCoordinates = Number.isFinite(lat) && Number.isFinite(lon) &&
          lat >= PH_LOCATION_BOUNDS.minLat && lat <= PH_LOCATION_BOUNDS.maxLat &&
          lon >= PH_LOCATION_BOUNDS.minLon && lon <= PH_LOCATION_BOUNDS.maxLon;
        const key = hasCoordinates
          ? `${normalizeLocationSearchText(feature.name)}|${lat.toFixed(5)}|${lon.toFixed(5)}`
          : `directory:${normalizeLocationSearchText(feature.name)}`;
        unique.set(key, { ...feature, ...(hasCoordinates ? { lat, lon } : {}) });
      });
      (Array.isArray(payload.features) ? payload.features : []).forEach(feature => {
        const parts = locationFeatureParts(feature);
        if (!parts) return;
        const searchable = normalizeLocationSearchText([parts.name, parts.address, parts.properties?.osm_key, parts.properties?.osm_value].filter(Boolean).join(' '));
        const matches = terms.filter(term => searchable.includes(term)).length;
        if (terms.length && matches < requiredMatches) return;
        const key = `${normalizeLocationSearchText(parts.name)}|${parts.lat.toFixed(5)}|${parts.lon.toFixed(5)}`;
        if (!unique.has(key)) unique.set(key, parts);
      });
      renderLocationSuggestions([...unique.values()].slice(0, 8));
    } catch (error) {
      if (error?.name === 'AbortError' || requestId !== locationSuggestRequestId) return;
      if (curatedMatches.length) renderLocationSuggestions(curatedMatches);
      else showLocationMessage('Location search unavailable', 'Check your internet connection and try again, or enter the complete court address manually.');
    }
  }

  function queuePhilippinesLocationSearch(rawQuery) {
    const input = $('liveQueueDuprLocation');
    const query = String(rawQuery || '').trim();
    locationSuggestRequestId += 1;
    const requestId = locationSuggestRequestId;
    window.clearTimeout(locationSuggestTimer);
    if (locationSuggestController) locationSuggestController.abort();
    if (!input || input.disabled || query.length < 3) {
      hideLocationSuggestions();
      return;
    }
    showLocationMessage('Searching Philippines locations…', 'Looking for matching courts, venues, and addresses.');
    locationSuggestTimer = window.setTimeout(() => searchPhilippinesLocations(query, requestId), 450);
  }

  function choosePhilippinesLocation(index) {
    const feature = locationSuggestFeatures[index];
    const input = $('liveQueueDuprLocation');
    if (!feature || !input || input.disabled) return;
    input.value = feature.label;
    setSelectedLocationCoordinates(feature);
    input.dataset.locationSelected = 'true';
    input.setCustomValidity('');
    hideLocationSuggestions();
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function bindPhilippinesLocationAutocomplete() {
    const picker = $('liveQueueLocationPicker');
    const input = $('liveQueueDuprLocation');
    const list = $('liveQueueDuprLocationSuggestions');
    if (!picker || !input || !list || picker.dataset.autocompleteBound === 'true') return;
    picker.dataset.autocompleteBound = 'true';

    input.addEventListener('input', () => {
      setSelectedLocationCoordinates(null);
      input.dataset.locationSelected = 'false';
      input.setCustomValidity('');
      queuePhilippinesLocationSearch(input.value);
    });
    input.addEventListener('focus', () => {
      if (!getSelectedLocationCoordinates() && String(input.value || '').trim().length >= 3) queuePhilippinesLocationSearch(input.value);
    });
    input.addEventListener('keydown', event => {
      if (list.hidden) return;
      const options = [...list.querySelectorAll('[data-location-option]')];
      if (event.key === 'ArrowDown' && options.length) {
        event.preventDefault();
        locationSuggestActiveIndex = Math.min(options.length - 1, locationSuggestActiveIndex + 1);
      } else if (event.key === 'ArrowUp' && options.length) {
        event.preventDefault();
        locationSuggestActiveIndex = Math.max(0, locationSuggestActiveIndex - 1);
      } else if (event.key === 'Enter' && locationSuggestActiveIndex >= 0) {
        event.preventDefault();
        choosePhilippinesLocation(locationSuggestActiveIndex);
      } else if (event.key === 'Escape') {
        hideLocationSuggestions();
        return;
      } else {
        return;
      }
      options.forEach((option, index) => {
        const active = index === locationSuggestActiveIndex;
        option.setAttribute('aria-selected', String(active));
        if (active) option.scrollIntoView({ block: 'nearest' });
      });
    });
    list.addEventListener('pointerdown', event => {
      if (event.target.closest('[data-location-option]')) event.preventDefault();
    });
    list.addEventListener('click', event => {
      const option = event.target.closest('[data-location-option]');
      if (option) choosePhilippinesLocation(Number(option.dataset.locationOption));
    });
    document.addEventListener('click', event => {
      if (!picker.contains(event.target)) hideLocationSuggestions();
    });
  }

  function syncDuprLocationVisibility() {
    const toggle = $('liveQueueDupr');
    const field = $('liveQueueDuprLocationField');
    const input = $('liveQueueDuprLocation');
    const duprEnabled = !!toggle?.checked;
    // Court location is useful for dashboard map pins on every session,
    // even when DUPR export is disabled. Only DUPR sessions require it.
    if (field) {
      field.classList.remove('hidden');
      field.classList.toggle('is-required', duprEnabled);
    }
    if (input) {
      input.disabled = hasExistingQueue(currentState);
      input.required = duprEnabled;
      input.setAttribute('aria-required', String(duprEnabled));
      if (!duprEnabled || String(input.value || '').trim()) input.setCustomValidity('');
    }
  }

  function syncDuprRecordingResults() {
    const duprToggle = $('liveQueueDupr');
    const recordToggle = $('liveQueueRecordResults');
    if (!recordToggle) return;

    const duprEnabled = !!duprToggle?.checked;
    const existing = hasExistingQueue(currentState);
    if (duprEnabled) recordToggle.checked = true;

    recordToggle.required = duprEnabled;
    recordToggle.setAttribute('aria-required', String(duprEnabled));
    recordToggle.setAttribute('aria-label', duprEnabled
      ? 'Record game scores (required for DUPR matches)'
      : 'Record game scores');
    recordToggle.disabled = existing || duprEnabled || recordToggle.dataset.originallyDisabled === 'true';
    recordToggle.setAttribute('aria-disabled', String(recordToggle.disabled));

    const row = recordToggle.closest('.record-results-toggle-row');
    if (row) {
      row.classList.toggle('is-required-by-dupr', duprEnabled);
      row.title = duprEnabled
        ? 'Recording results is required for DUPR matches'
        : 'Choose whether to record numeric game scores';
    }
  }

  function syncDuprLabelToggleText() {
    const toggle = $('liveQueueDuprLabels');
    const row = toggle?.closest('.dupr-labels-toggle-row');
    const status = $('liveQueueDuprLabelsStatus');
    const enabled = toggle ? !!toggle.checked : true;
    if (status) status.textContent = enabled ? 'DUPR ON · Show labels in Queueing' : 'DUPR OFF · Hide labels in Queueing';
    row?.classList.toggle('is-dupr-off', !enabled);
    if (toggle) toggle.setAttribute('aria-label', enabled ? 'DUPR ON — show labels in Queueing' : 'DUPR OFF — hide labels in Queueing');
  }

  function applyQueueAvailability() {
    const existing = hasExistingQueue(currentState);
    $('existingLiveQueueCard')?.classList.toggle('hidden', !existing);
    $('existingLiveQueueStats')?.classList.toggle('hidden', !existing);

    if (existing) {
      $('existingLiveQueueName').textContent = String(currentState.sessionName || 'Existing live queue');
      $('existingLiveQueuePlayersCount').textContent = String(Array.isArray(currentState.queue) ? currentState.queue.length : 0);
      $('existingLiveQueueCourtsCount').textContent = String(Array.isArray(currentState.courts) ? currentState.courts.filter(court => !court.waitingOnly).length : 0);
      $('existingLiveQueueMatchesCount').textContent = String(Array.isArray(currentState.logs) ? currentState.logs.length : 0);
      $('liveQueueStartSubtitle').textContent = 'An existing live queue is ready. Continue it to keep managing the same session.';
      if ($('liveQueueSessionName')) {
        $('liveQueueSessionName').value = String(currentState.sessionName || '(NON DUPR MATCH) Open Play');
        $('liveQueueSessionName').disabled = true;
      }
      if ($('liveQueueRecordResults')) $('liveQueueRecordResults').checked = !!currentState.recordScores;
      if ($('liveQueueDupr')) $('liveQueueDupr').checked = !!currentState.duprMatch;
      if ($('liveQueueDuprLocation')) $('liveQueueDuprLocation').value = String(currentState.duprLocation || '');
      setSelectedLocationCoordinates(currentState.duprLocationCoordinates || currentState.locationCoordinates || null);
      if ($('liveQueueDuprLabels')) $('liveQueueDuprLabels').checked = currentState.duprLabelsEnabled !== false;
      syncDuprLabelToggleText();
      syncDuprLocationVisibility();
      renderSessionNamePreview();
    } else {
      $('liveQueueStartSubtitle').textContent = 'Create a live queue session before entering the queueing workspace.';
      if ($('liveQueueSessionName')) $('liveQueueSessionName').disabled = false;
    }

    syncDuprLabelToggleText();
    syncDuprLocationVisibility();
    document.querySelectorAll('#liveQueueMatchType button, #liveQueueWinBy button, #liveQueueGameMode button, #liveQueueMatchingMode button, #liveQueueStartScreen .live-queue-toggle-row input').forEach(control => {
      control.disabled = existing || control.dataset.originallyDisabled === 'true';
      control.setAttribute('aria-disabled', control.disabled ? 'true' : 'false');
    });
    syncDuprRecordingResults();
    const recordResults = $('liveQueueRecordResults');
    if (recordResults) recordResults.setAttribute('aria-disabled', recordResults.disabled ? 'true' : 'false');
    const create = $('createLiveQueueBtn');
    if (create) {
      create.disabled = !stateCheckComplete || existing || isNavigating;
      create.setAttribute('aria-disabled', create.disabled ? 'true' : 'false');
    }
    const continueButton = $('continueLiveQueueBtn');
    if (continueButton) continueButton.disabled = !existing || isNavigating;
  }

  async function refreshSharedState() {
    const localState = readLocalState();
    currentState = localState;

    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const response = await fetch(`/api/app-state?_=${Date.now()}`, { cache: 'no-store' });
        if (response.ok) {
          const payload = await response.json();
          if (Number(payload && payload.revision) > sharedStateRevision) sharedStateRevision = Number(payload.revision) || sharedStateRevision;
          if (payload && payload.state && typeof payload.state === 'object') {
            const sessionChanged = sessionIdentityDiffers(payload.state, localState);
            const remoteIsTerminal = isEndedSession(payload.state);
            const localIsTerminal = isEndedSession(localState);
            if (sessionChanged || remoteIsTerminal || localIsTerminal || !readLocalPendingIsNewer(payload.updatedAt)) {
              currentState = payload.state;
              if (sessionChanged || remoteIsTerminal || localIsTerminal) persistRemoteState(currentState, payload.updatedAt);
            } else {
              currentState = localState;
            }
          } else if (!localState) {
            currentState = null;
          }
        }
      } catch (_) {
        // Fall back to this browser's saved state if the shared server is offline.
      }
    }

    stateCheckComplete = true;
    applyQueueAvailability();
    if (!hasExistingQueue(currentState)) syncSessionName();
  }

  function startSharedStateStream() {
    if (!(location.protocol === 'http:' || location.protocol === 'https:') || typeof EventSource === 'undefined') return;
    try {
      sharedStateSource = new EventSource('/api/shared-events');
      const source = sharedStateSource;
      source.addEventListener('app-state', event => {
        try {
          const payload = JSON.parse(event.data || '{}');
          const revision = Number(payload.revision) || 0;
          if (revision && revision <= sharedStateRevision) return;
          if (!payload.state || typeof payload.state !== 'object') return;
          if (revision) sharedStateRevision = revision;
          const localState = readLocalState();
          const sessionChanged = sessionIdentityDiffers(payload.state, currentState || localState);
          const remoteIsTerminal = isEndedSession(payload.state);
          const localIsTerminal = isEndedSession(currentState || localState);
          if (!sessionChanged && !remoteIsTerminal && !localIsTerminal && readLocalPendingIsNewer(payload.updatedAt)) return;
          currentState = payload.state;
          stateCheckComplete = true;
          if (sessionChanged || remoteIsTerminal || localIsTerminal) persistRemoteState(currentState, payload.updatedAt);
          applyQueueAvailability();
          if (!hasExistingQueue(currentState)) syncSessionName();
        } catch (_) {}
      });
      source.onerror = () => {
        // EventSource reconnects automatically; the existing polling remains as fallback.
      };
    } catch (_) {}
  }

  function collectStartConfig() {
    enforceSessionPrefix();
    return {
      sessionName: String($('liveQueueSessionName')?.value || '').trim() || getPrefix(!!$('liveQueueDupr')?.checked) + ' Open Play',
      duprMatch: !!$('liveQueueDupr')?.checked,
      type: document.querySelector('#liveQueueMatchType .live-queue-choice.active')?.dataset.value || 'Doubles',
      target: Number(document.querySelector('#liveQueueGameMode .live-queue-game.active')?.dataset.target) || 11,
      winBy: Number(document.querySelector('#liveQueueWinBy .live-queue-choice.active')?.dataset.value) || 1,
      matchingMode: document.querySelector('#liveQueueMatchingMode .live-queue-matching-option.active')?.dataset.mode || 'balanced',
      recordScores: !!$('liveQueueDupr')?.checked || !!$('liveQueueRecordResults')?.checked,
      duprLocation: String($('liveQueueDuprLocation')?.value || '').trim(),
      duprLocationCoordinates: getSelectedLocationCoordinates(),
      duprLabelsEnabled: $('liveQueueDuprLabels') ? !!$('liveQueueDuprLabels').checked : true
    };
  }

  async function createQueue() {
    if (isNavigating || !stateCheckComplete || hasExistingQueue(currentState)) return;

    // A DUPR session must have a real location before its queue can be created.
    const duprLocationInput = $('liveQueueDuprLocation');
    const duprEnabled = !!$('liveQueueDupr')?.checked;
    const duprLocation = String(duprLocationInput?.value || '').trim();
    if (duprLocationInput) {
      duprLocationInput.required = duprEnabled;
      duprLocationInput.setAttribute('aria-required', String(duprEnabled));
      if (duprEnabled && !duprLocation) {
        duprLocationInput.setCustomValidity('Enter the CSV location before creating a DUPR session.');
        duprLocationInput.reportValidity();
        duprLocationInput.focus();
        return;
      }
      duprLocationInput.setCustomValidity('');
    }

    isNavigating = true;
    applyQueueAvailability();

    // Recheck shared state immediately before creating so another device's session is not overwritten.
    await refreshSharedState();
    if (hasExistingQueue(currentState)) {
      applyQueueAvailability();
      isNavigating = false;
      applyQueueAvailability();
      return;
    }

    const config = collectStartConfig();
    try {
      sessionStorage.setItem(PENDING_START_CONFIG_KEY, JSON.stringify(config));
      sessionStorage.setItem('liveQueueView', 'workspace');
    } catch (_) {
      // sessionStorage is normally available for same-tab navigation; if blocked, don't lose the user's configuration silently.
      isNavigating = false;
      applyQueueAvailability();
      window.alert('Your browser blocked session storage, so the queue could not be opened. Please allow site storage and try again.');
      return;
    }
    window.location.assign('/queueing?create=1');
  }

  document.querySelectorAll('#liveQueueMatchType .live-queue-choice').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueMatchType .live-queue-choice', button);
  }));
  document.querySelectorAll('#liveQueueWinBy .live-queue-choice').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueWinBy .live-queue-choice', button);
  }));
  document.querySelectorAll('#liveQueueGameMode .live-queue-game').forEach(button => button.addEventListener('click', () => {
    if (!button.disabled) setGroupActive('#liveQueueGameMode .live-queue-game', button);
  }));
  document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(button => button.addEventListener('click', () => {
    if (button.disabled) return;
    document.querySelectorAll('#liveQueueMatchingMode .live-queue-matching-option').forEach(option => {
      const active = option === button;
      option.classList.toggle('active', active);
      option.setAttribute('aria-pressed', String(active));
    });
  }));
  $('liveQueueDupr')?.addEventListener('change', () => { syncSessionName(); syncDuprLocationVisibility(); syncDuprRecordingResults(); });
  $('liveQueueDuprLocation')?.addEventListener('change', event => {
    const input = event.currentTarget;
    if (!$('liveQueueDupr')?.checked || String(input.value || '').trim()) input.setCustomValidity('');
  });
  bindPhilippinesLocationAutocomplete();
  $('liveQueueDuprLabels')?.addEventListener('change', syncDuprLabelToggleText);
  $('liveQueueSessionName')?.addEventListener('input', enforceSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('focus', enforceSessionPrefix);
  $('liveQueueSessionName')?.addEventListener('scroll', renderSessionNamePreview);
  $('liveQueueSessionName')?.addEventListener('keydown', event => {
    const input = event.currentTarget;
    const prefixLength = getPrefix(!!$('liveQueueDupr')?.checked).length + 1;
    if ((input.selectionStart || 0) < prefixLength && !['Tab', 'Shift', 'Control', 'Alt', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      try { input.setSelectionRange(prefixLength, prefixLength); } catch (_) {}
    }
  });
  $('createLiveQueueBtn')?.addEventListener('click', createQueue);
  $('continueLiveQueueBtn')?.addEventListener('click', () => {
    if (!hasExistingQueue(currentState) || isNavigating) return;
    isNavigating = true;
    window.location.assign('/queueing');
  });

  syncSessionName();
  syncDuprLabelToggleText();
  syncDuprLocationVisibility();
  applyQueueAvailability();
  refreshSharedState().catch(() => {
    stateCheckComplete = true;
    currentState = readLocalState();
    applyQueueAvailability();
    if (!hasExistingQueue(currentState)) syncSessionName();
  });

  startSharedStateStream();

  // Keep this Start Screen's Existing Live Queue indicator fresh if the queue changes on another device.
  window.addEventListener('focus', () => { refreshSharedState(); });
  window.setInterval(() => { if (document.visibilityState !== 'hidden') refreshSharedState(); }, 15000);
})();
