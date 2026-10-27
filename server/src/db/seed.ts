/**
 * Seed the database with reference data and a small demo marketplace.
 *
 * Two distinct things are seeded here, and they are worth separating:
 *
 *   1. REFERENCE DATA — crop categories, application settings. This is real
 *      configuration the app needs to function. It is idempotent and safe to
 *      run against any environment, including production.
 *
 *   2. DEMO DATA — sample farmers, listings, orders. This exists so a fresh
 *      checkout has something to look at. It is clearly labelled, only created
 *      when SEED_DEMO_DATA is not set to "false", and every account uses the
 *      same obvious development password.
 *
 * Every price, quantity and quality figure below is invented for demonstration.
 * None of it is real market data, and the quality reports are deliberately left
 * unverified so the UI shows the honest "farmer-provided" state rather than a
 * verification badge nothing earned.
 */
import bcrypt from 'bcryptjs';
import { closePools, withOwnerTransaction } from './pool.js';

const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? 'RythuDemo123';
const SEED_DEMO = process.env.SEED_DEMO_DATA !== 'false';

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const CATEGORIES: Array<{
  slug: string; name: string; te: string; hi: string; icon: string; sort: number;
}> = [
  { slug: 'cereals', name: 'Cereals and Grains', te: 'ధాన్యాలు', hi: 'अनाज', icon: 'wheat', sort: 10 },
  { slug: 'pulses', name: 'Pulses and Lentils', te: 'పప్పు ధాన్యాలు', hi: 'दालें', icon: 'bean', sort: 20 },
  { slug: 'vegetables', name: 'Vegetables', te: 'కూరగాయలు', hi: 'सब्जियाँ', icon: 'carrot', sort: 30 },
  { slug: 'fruits', name: 'Fruits', te: 'పండ్లు', hi: 'फल', icon: 'apple', sort: 40 },
  { slug: 'oilseeds', name: 'Oilseeds', te: 'నూనె గింజలు', hi: 'तिलहन', icon: 'droplet', sort: 50 },
  { slug: 'spices', name: 'Spices and Condiments', te: 'మసాలాలు', hi: 'मसाले', icon: 'flame', sort: 60 },
  { slug: 'millets', name: 'Millets', te: 'చిరుధాన్యాలు', hi: 'मोटे अनाज', icon: 'sprout', sort: 70 },
  { slug: 'flowers', name: 'Flowers', te: 'పూలు', hi: 'फूल', icon: 'flower', sort: 80 },
  { slug: 'dairy', name: 'Dairy and Livestock', te: 'పాడి ఉత్పత్తులు', hi: 'डेयरी', icon: 'milk', sort: 90 },
  { slug: 'plantation', name: 'Plantation Crops', te: 'తోట పంటలు', hi: 'बागान फसलें', icon: 'trees', sort: 100 },
];

const SETTINGS: Array<{ key: string; value: unknown; description: string }> = [
  {
    key: 'platform_fee_percent',
    value: 0,
    description:
      'Platform commission as a percentage of the items subtotal. Zero while the marketplace is free to use.',
  },
  {
    key: 'max_delivery_radius_km',
    value: 150,
    description: 'Default search radius for nearby farmer discovery, in kilometres.',
  },
  {
    key: 'support_email',
    value: 'support@rythudirect.example',
    description: 'Shown on the contact and help pages.',
  },
  {
    key: 'support_phone',
    value: '+91 00000 00000',
    description: 'Placeholder. Replace with a real support number before going live.',
  },
  {
    key: 'quality_verification_sla_days',
    value: 5,
    description: 'Target number of working days to review a quality report or verification request.',
  },
  {
    key: 'review_moderation_enabled',
    value: true,
    description: 'Whether reports about reviews are routed to the administrator queue.',
  },
];

// ---------------------------------------------------------------------------
// Demo data
// ---------------------------------------------------------------------------

interface DemoFarmer {
  email: string;
  fullName: string;
  phone: string;
  language: 'en' | 'te' | 'hi';
  farmName: string;
  state: string;
  district: string;
  village: string;
  lat: number;
  lng: number;
  locationPublic: boolean;
  farmingType: string[];
  crops: string[];
  bio: string;
  offersDelivery: boolean;
  offersPickup: boolean;
  verification: 'verified' | 'pending' | 'unverified';
  products: DemoProduct[];
}

interface DemoProduct {
  name: string;
  category: string;
  variety: string;
  description: string;
  price: number;
  unit: string;
  stock: number;
  minOrder: number;
  grade: 'A' | 'B' | 'C' | 'ungraded';
  harvestDaysAgo: number;
  moisture?: number;
  organic?: boolean;
  bulk?: { minQty: number; price: number };
  deliveryCharge: number;
  offersDelivery?: boolean;
  offersPickup?: boolean;
  quality?: {
    title: string;
    summary: string;
    measurements: Record<string, unknown>;
    /** Left unverified on purpose: no reviewer has actually seen it. */
  };
}

const FARMERS: DemoFarmer[] = [
  {
    email: 'ravi.kumar@example.com',
    fullName: 'Ravi Kumar',
    phone: '+91 98480 11223',
    language: 'te',
    farmName: 'Sri Lakshmi Farms',
    state: 'Telangana',
    district: 'Warangal',
    village: 'Chityal',
    lat: 17.9689,
    lng: 79.5941,
    locationPublic: true,
    farmingType: ['Conventional', 'Irrigated'],
    crops: ['Paddy', 'Cotton', 'Maize'],
    bio:
      'Third-generation paddy farmer on 12 acres near Chityal. We mill our own rice ' +
      'and sell directly to families in Warangal and Hyderabad.',
    offersDelivery: true,
    offersPickup: true,
    verification: 'verified',
    products: [
      {
        name: 'Sona Masuri Rice',
        category: 'cereals',
        variety: 'Sona Masuri (BPT 5204)',
        description:
          'Freshly milled Sona Masuri from the current season. Light, medium-grain rice ' +
          'suitable for everyday meals. Stored in jute bags in a dry godown.',
        price: 62,
        unit: 'kg',
        stock: 2400,
        minOrder: 10,
        grade: 'A',
        harvestDaysAgo: 45,
        moisture: 12.5,
        bulk: { minQty: 100, price: 57 },
        deliveryCharge: 150,
        quality: {
          title: 'Moisture and purity check',
          summary:
            'Moisture measured with a calibrated meter at the mill. Foreign matter removed ' +
            'by destoner and magnetic separator.',
          measurements: { moisture_pct: 12.5, broken_grains_pct: 3.2, foreign_matter_pct: 0.4 },
        },
      },
      {
        name: 'Cotton (Kapas)',
        category: 'cereals',
        variety: 'Bt Cotton, medium staple',
        description:
          'Hand-picked kapas from rain-fed fields. Clean, well-dried, no trash. ' +
          'Sold by weight at the farm gate.',
        price: 7250,
        unit: 'quintal',
        stock: 85,
        minOrder: 1,
        grade: 'B',
        harvestDaysAgo: 30,
        moisture: 9.0,
        deliveryCharge: 0,
        offersDelivery: false,
        quality: {
          title: 'Staple and moisture note',
          summary: 'Staple length measured on a sample of 50 bolls. Moisture checked before bagging.',
          measurements: { staple_mm: 29, moisture_pct: 9.0, trash_pct: 1.8 },
        },
      },
    ],
  },
  {
    email: 'lakshmi.devi@example.com',
    fullName: 'Lakshmi Devi',
    phone: '+91 90000 44556',
    language: 'te',
    farmName: 'Devi Organics',
    state: 'Andhra Pradesh',
    district: 'Krishna',
    village: 'Penamaluru',
    lat: 16.5062,
    lng: 80.6480,
    locationPublic: true,
    farmingType: ['Organic (in conversion)', 'Drip irrigated'],
    crops: ['Vegetables', 'Banana', 'Pulses'],
    bio:
      'We grow vegetables on 6 acres using organic methods. No synthetic pesticides for ' +
      'the last three years. Our organic certification is in progress, not yet issued.',
    offersDelivery: true,
    offersPickup: true,
    verification: 'pending',
    products: [
      {
        name: 'Tomatoes',
        category: 'vegetables',
        variety: 'Sahoo, semi-determinate',
        description:
          'Firm, uniform tomatoes harvested to order. Graded by size, packed in crates. ' +
          'Best used within five days of delivery.',
        price: 28,
        unit: 'kg',
        stock: 800,
        minOrder: 5,
        grade: 'A',
        harvestDaysAgo: 2,
        bulk: { minQty: 50, price: 24 },
        deliveryCharge: 100,
        quality: {
          title: 'Field notes and grading',
          summary:
            'Graded by diameter. Fruit firmness checked by hand. No synthetic pesticide ' +
            'applied during this crop cycle; this is a farmer statement, not a laboratory result.',
          measurements: { average_diameter_mm: 58, firmness: 'firm', grading: 'size-graded' },
        },
      },
      {
        name: 'Banana (G-9)',
        category: 'fruits',
        variety: 'Grand Naine (G-9)',
        description:
          'Whole bunches of G-9 banana, cut green for transport. Ripens in four to six days ' +
          'at room temperature.',
        price: 1450,
        unit: 'quintal',
        stock: 42,
        minOrder: 1,
        grade: 'A',
        harvestDaysAgo: 1,
        deliveryCharge: 300,
        quality: {
          title: 'Bunch grading record',
          summary: 'Bunches selected by finger count and evenness. Cut with a clean tool, not dropped.',
          measurements: { fingers_per_bunch: 14, bunch_weight_kg: 18, evenness: 'good' },
        },
      },
      {
        name: 'Toor Dal (Pigeon Pea)',
        category: 'pulses',
        variety: 'Local red variety',
        description:
          'Hand-sorted toor dal from our own crop. Double-polished, no artificial colour. ' +
          'Packed in 30 kg bags.',
        price: 138,
        unit: 'kg',
        stock: 350,
        minOrder: 5,
        grade: 'A',
        harvestDaysAgo: 90,
        moisture: 10.2,
        bulk: { minQty: 30, price: 129 },
        deliveryCharge: 150,
        quality: {
          title: 'Handling and moisture record',
          summary: 'Sun-dried to safe moisture, machine-cleaned, hand-picked for damaged grains.',
          measurements: { moisture_pct: 10.2, damaged_grains_pct: 1.1, foreign_matter_pct: 0.3 },
        },
      },
    ],
  },
  {
    email: 'suresh.patel@example.com',
    fullName: 'Suresh Patel',
    phone: '+91 99790 77881',
    language: 'hi',
    farmName: 'Patel Krishi Farm',
    state: 'Gujarat',
    district: 'Junagadh',
    village: 'Keshod',
    lat: 21.3010,
    lng: 70.2480,
    locationPublic: true,
    farmingType: ['Conventional', 'Rain-fed'],
    crops: ['Groundnut', 'Wheat', 'Castor'],
    bio:
      'Groundnut and wheat on 20 acres of black soil. We supply oil mills and direct ' +
      'buyers in Saurashtra.',
    offersDelivery: true,
    offersPickup: true,
    verification: 'verified',
    products: [
      {
        name: 'Groundnut (Bold)',
        category: 'oilseeds',
        variety: 'Gujarat Junagadh Bold',
        description:
          'Bold groundnut kernels, hand-picked and machine-cleaned. Suitable for oil ' +
          'extraction or direct consumption. Sold in 40 kg bags.',
        price: 6250,
        unit: 'quintal',
        stock: 180,
        minOrder: 1,
        grade: 'A',
        harvestDaysAgo: 60,
        moisture: 6.5,
        bulk: { minQty: 10, price: 5980 },
        deliveryCharge: 400,
        quality: {
          title: 'Kernel grading record',
          summary: 'Kernels screened for size and split grains removed. Aflatoxin testing has NOT been carried out.',
          measurements: { moisture_pct: 6.5, oil_content_pct: 48, split_kernels_pct: 2.0 },
        },
      },
      {
        name: 'Wheat (Lokwan)',
        category: 'cereals',
        variety: 'Lokwan',
        description:
          'Lokwan wheat, the preferred variety for chapati flour in Gujarat. Cleaned and ' +
          'ready for milling.',
        price: 2850,
        unit: 'quintal',
        stock: 240,
        minOrder: 1,
        grade: 'A',
        harvestDaysAgo: 75,
        moisture: 11.0,
        deliveryCharge: 350,
        quality: {
          title: 'Grain quality note',
          summary: 'Moisture checked at the warehouse. Grain is free of visible insect damage.',
          measurements: { moisture_pct: 11.0, hectolitre_weight_kg: 78, damaged_grains_pct: 1.5 },
        },
      },
    ],
  },
  {
    email: 'anitha.reddy@example.com',
    fullName: 'Anitha Reddy',
    phone: '+91 96180 33221',
    language: 'te',
    farmName: 'Green Valley Farm',
    state: 'Telangana',
    district: 'Rangareddy',
    village: 'Shamshabad',
    lat: 17.2403,
    lng: 78.4294,
    locationPublic: true,
    farmingType: ['Polyhouse', 'Drip irrigated'],
    crops: ['Vegetables', 'Flowers', 'Millets'],
    bio:
      'We grow vegetables under polyhouse and millets in open fields. We supply ' +
      'restaurants and retail customers around Hyderabad.',
    offersDelivery: true,
    offersPickup: false,
    verification: 'verified',
    products: [
      {
        name: 'Millet (Foxtail)',
        category: 'millets',
        variety: 'Foxtail millet (Korralu)',
        description:
          'Foxtail millet, dehusked and cleaned. A low-water crop grown without ' +
          'synthetic fertiliser. Good for millet rice and upma.',
        price: 92,
        unit: 'kg',
        stock: 600,
        minOrder: 5,
        grade: 'A',
        harvestDaysAgo: 50,
        moisture: 11.8,
        bulk: { minQty: 50, price: 84 },
        deliveryCharge: 120,
        quality: {
          title: 'Dehusking and cleaning record',
          summary: 'Dehusked on a small mill, winnowed and hand-sorted. No polishing, so the bran layer is retained.',
          measurements: { moisture_pct: 11.8, husk_remaining_pct: 0.2, broken_grains_pct: 2.5 },
        },
      },
      {
        name: 'Green Chilli',
        category: 'vegetables',
        variety: 'Guntur local, medium hot',
        description:
          'Green chilli picked at the correct stage for fresh market. Crates are packed ' +
          'loosely to prevent bruising in transit.',
        price: 42,
        unit: 'kg',
        stock: 250,
        minOrder: 5,
        grade: 'A',
        harvestDaysAgo: 1,
        deliveryCharge: 150,
        quality: {
          title: 'Harvest and packing note',
          summary: 'Harvested in the early morning and moved to shade immediately. Packed in ventilated crates.',
          measurements: { average_length_cm: 8.5, pungency: 'medium', packing: 'ventilated crates' },
        },
      },
    ],
  },
  {
    email: 'mahesh.naidu@example.com',
    fullName: 'Mahesh Naidu',
    phone: '+91 94400 66554',
    language: 'te',
    farmName: 'Naidu Plantations',
    state: 'Karnataka',
    district: 'Chikkamagaluru',
    village: 'Mudigere',
    lat: 13.1333,
    lng: 75.2833,
    locationPublic: false,
    farmingType: ['Shade grown', 'Conventional'],
    crops: ['Coffee', 'Pepper', 'Cardamom'],
    bio:
      'Shade-grown coffee and pepper on the Western Ghats slopes. We have been farming ' +
      'this land since 1972.',
    offersDelivery: true,
    offersPickup: true,
    verification: 'unverified',
    products: [
      {
        name: 'Arabica Coffee (Parchment)',
        category: 'plantation',
        variety: 'Arabica, Kavery selection',
        description:
          'Parchment arabica from a single estate. Hand-picked ripe cherry, pulped the ' +
          'same day, dried on raised beds.',
        price: 320,
        unit: 'kg',
        stock: 450,
        minOrder: 5,
        grade: 'A',
        harvestDaysAgo: 20,
        moisture: 10.5,
        bulk: { minQty: 50, price: 295 },
        deliveryCharge: 250,
        quality: {
          title: 'Green bean preparation note',
          summary: 'Pulped same-day and dried on raised beds for 12 days. Sorted for black and broken beans.',
          measurements: { moisture_pct: 10.5, screen_size: '15-16', defect_count: 8 },
        },
      },
    ],
  },
  {
    email: 'farhan.khan@example.com',
    fullName: 'Farhan Khan',
    phone: '+91 98220 11009',
    language: 'hi',
    farmName: 'Khan Sahiwal Dairy',
    state: 'Uttar Pradesh',
    district: 'Bareilly',
    village: 'Aonla',
    lat: 28.3640,
    lng: 79.4140,
    locationPublic: true,
    farmingType: ['Mixed farming', 'Dairy'],
    crops: ['Fodder', 'Sugarcane'],
    bio:
      'A small family dairy with 18 Sahiwal cows and fodder fields. Milk is chilled ' +
      'within an hour of milking.',
    offersDelivery: true,
    offersPickup: true,
    verification: 'pending',
    products: [
      {
        name: 'A2 Cow Milk',
        category: 'dairy',
        variety: 'Sahiwal',
        description:
          'Whole A2 milk from Sahiwal cows, chilled immediately after milking. Delivered ' +
          'in stainless steel cans within the district.',
        price: 68,
        unit: 'litre',
        stock: 120,
        minOrder: 2,
        grade: 'A',
        harvestDaysAgo: 0,
        deliveryCharge: 50,
        quality: {
          title: 'Milk handling record',
          summary:
            'Milk chilled to 4 degrees within one hour. Fat and SNF measured at the dairy. ' +
            'No laboratory residue testing has been carried out.',
          measurements: { fat_pct: 4.2, snf_pct: 8.6, chilling_temp_c: 4 },
        },
      },
    ],
  },
];

const CUSTOMERS = [
  {
    email: 'priya.sharma@example.com',
    fullName: 'Priya Sharma',
    phone: '+91 99001 22334',
    language: 'en' as const,
    state: 'Telangana',
    district: 'Hyderabad',
    village: 'Kondapur',
    address: 'Flat 402, Sai Residency, Botanical Garden Road, Kondapur, Hyderabad',
    postalCode: '500084',
  },
  {
    email: 'arjun.rao@example.com',
    fullName: 'Arjun Rao',
    phone: '+91 97000 88997',
    language: 'te' as const,
    state: 'Telangana',
    district: 'Hyderabad',
    village: 'Gachibowli',
    address: 'Villa 12, Lake Ridge, Gachibowli, Hyderabad',
    postalCode: '500032',
  },
];

const ADMIN = {
  email: 'admin@rythudirect.example',
  fullName: 'RythuDirect Administrator',
  phone: '+91 80000 00001',
};

async function seed(): Promise<void> {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  await withOwnerTransaction(async (client) => {
    // -----------------------------------------------------------------------
    // Reference data. Idempotent, so re-running never duplicates or resets.
    // -----------------------------------------------------------------------
    for (const category of CATEGORIES) {
      await client.query(
        `INSERT INTO crop_categories (slug, name, localized_names, icon, sort_order, is_active)
         VALUES ($1, $2, $3::jsonb, $4, $5, true)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name,
               localized_names = EXCLUDED.localized_names,
               icon = EXCLUDED.icon,
               sort_order = EXCLUDED.sort_order`,
        [
          category.slug,
          category.name,
          JSON.stringify({ te: category.te, hi: category.hi }),
          category.icon,
          category.sort,
        ],
      );
    }
    console.log(`Reference: ${CATEGORIES.length} crop categories`);

    for (const setting of SETTINGS) {
      await client.query(
        `INSERT INTO app_settings (key, value, description)
         VALUES ($1, $2::jsonb, $3)
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value, description = EXCLUDED.description`,
        [setting.key, JSON.stringify(setting.value), setting.description],
      );
    }
    console.log(`Reference: ${SETTINGS.length} application settings`);

    // -----------------------------------------------------------------------
    // Administrator.
    //
    // Created here rather than through the registration API, because the API
    // deliberately refuses to create an admin. This is the "secure
    // administrative provisioning process": it requires direct database access
    // with the owner role.
    // -----------------------------------------------------------------------
    const admin = await upsertProfile(client, {
      email: ADMIN.email,
      fullName: ADMIN.fullName,
      phone: ADMIN.phone,
      role: 'admin',
      language: 'en',
      passwordHash,
    });
    console.log(`Admin: ${ADMIN.email} (password from SEED_DEMO_PASSWORD)`);

    if (!SEED_DEMO) {
      console.log('\nSEED_DEMO_DATA=false, so no demo marketplace was created.');
      return;
    }

    // -----------------------------------------------------------------------
    // Demo marketplace.
    // -----------------------------------------------------------------------
    const categoryIds = new Map<string, number>();
    const categories = await client.query<{ id: number; slug: string }>(
      'SELECT id, slug FROM crop_categories',
    );
    for (const row of categories.rows) categoryIds.set(row.slug, row.id);

    const customerIds: string[] = [];
    for (const customer of CUSTOMERS) {
      const id = await upsertProfile(client, {
        email: customer.email,
        fullName: customer.fullName,
        phone: customer.phone,
        role: 'customer',
        language: customer.language,
        passwordHash,
      });
      customerIds.push(id);

      const existingAddress = await client.query(
        'SELECT id FROM customer_addresses WHERE customer_id = $1 LIMIT 1',
        [id],
      );
      if (existingAddress.rowCount === 0) {
        await client.query(
          `INSERT INTO customer_addresses
             (customer_id, label, recipient_name, phone, address_line, state, district,
              village, postal_code, is_default)
           VALUES ($1, 'Home', $2, $3, $4, $5, $6, $7, $8, true)`,
          [
            id, customer.fullName, customer.phone, customer.address,
            customer.state, customer.district, customer.village, customer.postalCode,
          ],
        );
      }
    }
    console.log(`Demo: ${CUSTOMERS.length} customers with delivery addresses`);

    let productCount = 0;
    let qualityCount = 0;

    for (const farmer of FARMERS) {
      const farmerId = await upsertProfile(client, {
        email: farmer.email,
        fullName: farmer.fullName,
        phone: farmer.phone,
        role: 'farmer',
        language: farmer.language,
        passwordHash,
      });

      await client.query(
        `INSERT INTO farmer_profiles
           (user_id, farm_name, state, district, village, public_address,
            latitude, longitude, location_public, farming_type, crops_cultivated,
            bio, offers_delivery, offers_pickup, verification_status, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::verification_status,$16)
         ON CONFLICT (user_id) DO UPDATE
           SET farm_name = EXCLUDED.farm_name,
               state = EXCLUDED.state,
               district = EXCLUDED.district,
               village = EXCLUDED.village,
               latitude = EXCLUDED.latitude,
               longitude = EXCLUDED.longitude,
               location_public = EXCLUDED.location_public,
               farming_type = EXCLUDED.farming_type,
               crops_cultivated = EXCLUDED.crops_cultivated,
               bio = EXCLUDED.bio,
               offers_delivery = EXCLUDED.offers_delivery,
               offers_pickup = EXCLUDED.offers_pickup,
               verification_status = EXCLUDED.verification_status,
               verified_at = EXCLUDED.verified_at`,
        [
          farmerId, farmer.farmName, farmer.state, farmer.district, farmer.village,
          `${farmer.village}, ${farmer.district}, ${farmer.state}`,
          farmer.lat, farmer.lng, farmer.locationPublic,
          farmer.farmingType, farmer.crops, farmer.bio,
          farmer.offersDelivery, farmer.offersPickup,
          farmer.verification,
          farmer.verification === 'verified' ? new Date() : null,
        ],
      );

      for (const product of farmer.products) {
        const harvestDate = new Date(Date.now() - product.harvestDaysAgo * 86_400_000)
          .toISOString()
          .slice(0, 10);

        const existing = await client.query<{ id: string }>(
          'SELECT id FROM products WHERE farmer_id = $1 AND name = $2 LIMIT 1',
          [farmerId, product.name],
        );

        let productId: string;
        if (existing.rowCount && existing.rows[0]) {
          productId = existing.rows[0].id;
          await client.query(
            `UPDATE products SET
               category_id = $1, variety = $2, description = $3, price = $4, unit = $5::quantity_unit,
               stock_quantity = $6, minimum_order_quantity = $7, bulk_min_quantity = $8,
               bulk_price_per_unit = $9, delivery_charge = $10, harvest_date = $11::date,
               grade = $12::quality_grade, moisture_content = $13, organic_certified = $14,
               offers_delivery = $15, offers_pickup = $16, status = 'active'
             WHERE id = $17`,
            [
              categoryIds.get(product.category) ?? null, product.variety, product.description,
              product.price, product.unit, product.stock, product.minOrder,
              product.bulk?.minQty ?? null, product.bulk?.price ?? null,
              product.deliveryCharge, harvestDate, product.grade,
              product.moisture ?? null, product.organic ?? false,
              product.offersDelivery ?? farmer.offersDelivery,
              product.offersPickup ?? farmer.offersPickup,
              productId,
            ],
          );
        } else {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO products (
               farmer_id, name, category_id, variety, description,
               state, district, village, price, unit, stock_quantity, minimum_order_quantity,
               bulk_min_quantity, bulk_price_per_unit, delivery_charge, harvest_date,
               grade, moisture_content, organic_certified, offers_delivery, offers_pickup,
               latitude, longitude, status
             ) VALUES (
               $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::quantity_unit,$11,$12,$13,$14,$15,$16::date,
               $17::quality_grade,$18,$19,$20,$21,$22,$23,'active'
             ) RETURNING id`,
            [
              farmerId, product.name, categoryIds.get(product.category) ?? null,
              product.variety, product.description,
              farmer.state, farmer.district, farmer.village,
              product.price, product.unit, product.stock, product.minOrder,
              product.bulk?.minQty ?? null, product.bulk?.price ?? null,
              product.deliveryCharge, harvestDate,
              product.grade, product.moisture ?? null, product.organic ?? false,
              product.offersDelivery ?? farmer.offersDelivery,
              product.offersPickup ?? farmer.offersPickup,
              farmer.lat, farmer.lng,
            ],
          );
          productId = inserted.rows[0]!.id;
        }
        productCount += 1;

        if (product.quality) {
          const already = await client.query(
            'SELECT id FROM crop_quality_reports WHERE product_id = $1 LIMIT 1',
            [productId],
          );
          if (already.rowCount === 0) {
            // Left unverified. A seed script cannot grant an official
            // verification, and it would be dishonest to imply one exists.
            await client.query(
              `INSERT INTO crop_quality_reports
                 (product_id, submitted_by, report_type, title, summary, measurements,
                  verification_status)
               VALUES ($1, $2, 'farmer_provided', $3, $4, $5::jsonb, 'unverified')`,
              [
                productId, farmerId, product.quality.title,
                product.quality.summary,
                JSON.stringify(product.quality.measurements),
              ],
            );
            qualityCount += 1;
          }
        }
      }
    }

    console.log(`Demo: ${FARMERS.length} farmers, ${productCount} active listings`);
    console.log(`Demo: ${qualityCount} farmer-provided quality reports (all unverified)`);

    // -----------------------------------------------------------------------
    // One completed order, so the review and rating flows have real data to
    // work with instead of an empty state.
    // -----------------------------------------------------------------------
    const existingOrders = await client.query('SELECT count(*)::int AS n FROM orders');
    if ((existingOrders.rows[0]?.n ?? 0) === 0 && customerIds.length > 0) {
      await createDemoOrder(client, customerIds[0]!);
      console.log('Demo: 1 completed order with a review');
    }

    // Market observations: labelled as manual entries with explicit dates, so
    // the UI shows them as reference figures rather than live mandi prices.
    const existingObservations = await client.query(
      'SELECT count(*)::int AS n FROM market_price_observations',
    );
    if ((existingObservations.rows[0]?.n ?? 0) === 0) {
      await seedMarketObservations(client, { id: admin });
      console.log('Demo: market price observations (manual entries, dated)');
    }
  });
}

async function upsertProfile(
  client: import('pg').PoolClient,
  input: {
    email: string;
    fullName: string;
    phone: string;
    role: 'farmer' | 'customer' | 'admin';
    language: 'en' | 'te' | 'hi';
    passwordHash: string;
  },
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    'SELECT id FROM profiles WHERE email = $1',
    [input.email],
  );

  if (existing.rowCount && existing.rows[0]) {
    const id = existing.rows[0].id;
    // Email is treated as confirmed for seeded accounts: there is no inbox to
    // click a link in, and leaving them unverified would make the demo
    // unusable without being any more secure.
    await client.query(
      `UPDATE profiles
          SET full_name = $1, phone = $2, role = $3::user_role,
              preferred_language = $4::language_code, email_verified = true
        WHERE id = $5`,
      [input.fullName, input.phone, input.role, input.language, id],
    );
    return id;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO profiles
       (email, password_hash, full_name, phone, role, preferred_language, email_verified)
     VALUES ($1, $2, $3, $4, $5::user_role, $6::language_code, true)
     RETURNING id`,
    [input.email, input.passwordHash, input.fullName, input.phone, input.role, input.language],
  );
  return created.rows[0]!.id;
}

async function createDemoOrder(
  client: import('pg').PoolClient,
  customerId: string,
): Promise<void> {
  // Pick a listing that has plenty of stock so the demo order does not distort
  // the numbers for a listing the user is likely to test ordering against.
  const product = await client.query<{
    id: string; farmer_id: string; name: string; price: number; unit: string;
  }>(
    `SELECT id, farmer_id, name, price, unit::text AS unit
       FROM products
      WHERE status = 'active' AND stock_quantity > 100
      ORDER BY price ASC
      LIMIT 1`,
  );
  const row = product.rows[0];
  if (!row) return;

  const quantity = 20;
  const subtotal = Number(row.price) * quantity;

  const order = await client.query<{ id: string }>(
    `INSERT INTO orders (
       order_number, customer_id, farmer_id, total_amount, items_subtotal,
       delivery_charge, fulfilment_method, order_status, payment_status,
       delivery_address_snapshot, placed_at, delivered_at
     ) VALUES (
       next_order_number(), $1, $2, $3, $3, 0, 'pickup', 'delivered', 'captured',
       (SELECT jsonb_build_object(
          'recipient_name', recipient_name, 'phone', phone, 'address_line', address_line,
          'state', state, 'district', district, 'village', village, 'postal_code', postal_code)
          FROM customer_addresses WHERE customer_id = $1 ORDER BY is_default DESC LIMIT 1),
       now() - interval '12 days', now() - interval '9 days'
     ) RETURNING id`,
    [customerId, row.farmer_id, subtotal],
  );
  const orderId = order.rows[0]!.id;

  await client.query(
    `INSERT INTO order_items (
       order_id, product_id, farmer_id, product_name_snapshot, unit_snapshot,
       quantity, unit_price_snapshot, subtotal, created_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() - interval '12 days')`,
    [orderId, row.id, row.farmer_id, row.name, row.unit, quantity, row.price, subtotal],
  );

  // Stock was decremented at reservation time in the real flow; do the same
  // here so the listing quantity stays consistent with what was sold.
  await client.query(
    'UPDATE products SET stock_quantity = stock_quantity - $1 WHERE id = $2',
    [quantity, row.id],
  );

  await client.query(
    `INSERT INTO payments (order_id, provider, amount, status, method, signature_verified, created_at)
     VALUES ($1, 'cod', $2, 'captured', 'cash_on_delivery', true, now() - interval '9 days')`,
    [orderId, subtotal],
  );

  await client.query(
    `INSERT INTO reviews
       (order_id, product_id, farmer_id, customer_id, product_rating, seller_rating,
        comment, is_verified_purchase, created_at)
     VALUES ($1, $2, $3, $4, 5, 5, $5, true, now() - interval '8 days')`,
    [
      orderId, row.id, row.farmer_id, customerId,
      'Good quality grain, clean and dry as described. The farmer answered my questions ' +
        'before I ordered and the pickup was straightforward.',
    ],
  );
}

/**
 * Market price observations.
 *
 * These are MANUAL ENTRIES with explicit observation dates. They are not live
 * Agmarknet data and the source column says so, which is what lets the market
 * insights page label them honestly instead of presenting them as official
 * current prices.
 */
async function seedMarketObservations(
  client: import('pg').PoolClient,
  admin: { id: string },
): Promise<void> {
  const observations: Array<{
    commodity: string; state: string; district: string; market: string;
    min: number; max: number; modal: number; unit: string; daysAgo: number;
  }> = [
    { commodity: 'Sona Masuri Rice', state: 'Telangana', district: 'Warangal', market: 'Warangal', min: 2900, max: 3350, modal: 3120, unit: 'quintal', daysAgo: 6 },
    { commodity: 'Sona Masuri Rice', state: 'Telangana', district: 'Warangal', market: 'Warangal', min: 2850, max: 3300, modal: 3050, unit: 'quintal', daysAgo: 20 },
    { commodity: 'Sona Masuri Rice', state: 'Telangana', district: 'Warangal', market: 'Warangal', min: 2950, max: 3400, modal: 3180, unit: 'quintal', daysAgo: 41 },
    { commodity: 'Cotton (Kapas)', state: 'Telangana', district: 'Warangal', market: 'Warangal', min: 6800, max: 7450, modal: 7150, unit: 'quintal', daysAgo: 4 },
    { commodity: 'Cotton (Kapas)', state: 'Telangana', district: 'Warangal', market: 'Warangal', min: 6650, max: 7300, modal: 7020, unit: 'quintal', daysAgo: 25 },
    { commodity: 'Tomatoes', state: 'Andhra Pradesh', district: 'Krishna', market: 'Vijayawada', min: 1800, max: 2600, modal: 2200, unit: 'quintal', daysAgo: 3 },
    { commodity: 'Tomatoes', state: 'Andhra Pradesh', district: 'Krishna', market: 'Vijayawada', min: 1500, max: 2300, modal: 1900, unit: 'quintal', daysAgo: 17 },
    { commodity: 'Banana (G-9)', state: 'Andhra Pradesh', district: 'Krishna', market: 'Vijayawada', min: 1200, max: 1800, modal: 1500, unit: 'quintal', daysAgo: 5 },
    { commodity: 'Toor Dal (Pigeon Pea)', state: 'Andhra Pradesh', district: 'Krishna', market: 'Vijayawada', min: 12500, max: 14200, modal: 13350, unit: 'quintal', daysAgo: 9 },
    { commodity: 'Groundnut (Bold)', state: 'Gujarat', district: 'Junagadh', market: 'Junagadh', min: 5900, max: 6600, modal: 6250, unit: 'quintal', daysAgo: 7 },
    { commodity: 'Groundnut (Bold)', state: 'Gujarat', district: 'Junagadh', market: 'Junagadh', min: 5750, max: 6450, modal: 6100, unit: 'quintal', daysAgo: 22 },
    { commodity: 'Wheat (Lokwan)', state: 'Gujarat', district: 'Junagadh', market: 'Junagadh', min: 2600, max: 3050, modal: 2820, unit: 'quintal', daysAgo: 11 },
    { commodity: 'Millet (Foxtail)', state: 'Telangana', district: 'Rangareddy', market: 'Hyderabad', min: 8200, max: 9600, modal: 8900, unit: 'quintal', daysAgo: 8 },
    { commodity: 'Green Chilli', state: 'Telangana', district: 'Rangareddy', market: 'Hyderabad', min: 3200, max: 4800, modal: 4000, unit: 'quintal', daysAgo: 2 },
    { commodity: 'Arabica Coffee (Parchment)', state: 'Karnataka', district: 'Chikkamagaluru', market: 'Chikkamagaluru', min: 29000, max: 34000, modal: 31500, unit: 'quintal', daysAgo: 14 },
  ];

  for (const observation of observations) {
    const observedOn = new Date(Date.now() - observation.daysAgo * 86_400_000)
      .toISOString()
      .slice(0, 10);
    await client.query(
      `INSERT INTO market_price_observations
         (commodity, state, district, market_name, min_price, max_price, modal_price,
          unit, source, source_ref, observed_on, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::quantity_unit,'manual_entry',$9,$10::date,$11)`,
      [
        observation.commodity, observation.state, observation.district, observation.market,
        observation.min, observation.max, observation.modal, observation.unit,
        'Seeded demo reference figure, not an official Agmarknet record',
        observedOn, admin.id,
      ],
    );
  }
}

try {
  await seed();
  console.log('\nSeed complete.');
  if (SEED_DEMO) {
    console.log(`\nDemo sign-in credentials (password for every account): ${DEMO_PASSWORD}`);
    console.log(`  farmer   ${FARMERS[0]!.email}`);
    console.log(`  customer ${CUSTOMERS[0]!.email}`);
    console.log(`  admin    ${ADMIN.email}`);
    console.log('\nChange these before any deployment that is reachable from the internet.');
  }
} catch (err) {
  console.error('Seed failed:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await closePools();
}
