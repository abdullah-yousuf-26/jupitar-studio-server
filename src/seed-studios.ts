import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const sampleStudios = [
  {
    id: "00000000000000000000a001",
    title: "Daylight Photography Loft",
    category: "photo",
    location: "Dhanmondi, Dhaka",
    hourlyRate: 45,
    securityDeposit: 80,
    maxCapacity: 6,
    rating: 4.9,
    imageUrl: "/images/hero/photography-studio.png",
    amenities: ["Natural light", "Seamless backdrop", "Changing area"],
    overview: "A daylight loft for portrait sessions and small editorial shoots.",
  },
  {
    id: "00000000000000000000a002",
    title: "Orbit Podcast Room",
    category: "podcast",
    location: "Banani, Dhaka",
    hourlyRate: 30,
    securityDeposit: 50,
    maxCapacity: 4,
    rating: 4.8,
    imageUrl: "/images/hero/podcast-room.png",
    amenities: ["Four microphones", "Headphones", "Acoustic panels"],
    overview: "A four-seat recording room for interviews and roundtable podcasts.",
  },
  {
    id: "00000000000000000000a003",
    title: "Amber Sound Suite",
    category: "music",
    location: "Uttara, Dhaka",
    hourlyRate: 55,
    securityDeposit: 100,
    maxCapacity: 5,
    rating: 4.9,
    imageUrl: "/images/hero/music-studio.png",
    amenities: ["Vocal booth", "Mixing desk", "Studio monitors"],
    overview: "A recording suite with a separate booth for vocals and voiceovers.",
  },
  {
    id: "00000000000000000000a004",
    title: "Frame One Sound Stage",
    category: "film",
    location: "Tejgaon, Dhaka",
    hourlyRate: 90,
    securityDeposit: 150,
    maxCapacity: 18,
    rating: 4.7,
    imageUrl: null,
    amenities: ["Blackout curtains", "Lighting grid", "Equipment access"],
    overview: "A blackout stage with room for a small film crew and set pieces.",
  },
  {
    id: "00000000000000000000a005",
    title: "Clay and Canvas Workshop",
    category: "workshop",
    location: "Lalmatia, Dhaka",
    hourlyRate: 25,
    securityDeposit: 40,
    maxCapacity: 12,
    rating: 4.8,
    imageUrl: null,
    amenities: ["Worktables", "Wash station", "Drying shelves"],
    overview: "A hands-on workspace for painting classes and small craft workshops.",
  },
  {
    id: "00000000000000000000a006",
    title: "Product Photography Corner",
    category: "photo",
    location: "Mirpur, Dhaka",
    hourlyRate: 35,
    securityDeposit: 60,
    maxCapacity: 3,
    rating: 4.6,
    imageUrl: null,
    amenities: ["Shooting table", "Softboxes", "Product stands"],
    overview: "A tabletop setup for photographing cosmetics, food, and small products.",
  },
  {
    id: "00000000000000000000a007",
    title: "Two Mic Interview Studio",
    category: "podcast",
    location: "Mohakhali, Dhaka",
    hourlyRate: 28,
    securityDeposit: 45,
    maxCapacity: 2,
    rating: 4.7,
    imageUrl: null,
    amenities: ["Two microphones", "Audio recorder", "Headphones"],
    overview: "A quiet two-person studio for interviews and spoken-word recordings.",
  },
];

async function seedStudios() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME;

  if (!uri || dbName !== "jupitar_studio") {
    throw new Error(
      "Check your server .env: set MONGODB_URI and MONGODB_DB_NAME=jupitar_studio."
    );
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const studios = client.db(dbName).collection("studios");

    const operations = sampleStudios.map(({ id, ...listing }) => ({
      updateOne: {
        filter: { _id: new ObjectId(id) },
        update: {
          $setOnInsert: {
            ...listing,
            ownerName: "JUPITAR STUDIO Demo Host",
            ownerEmail: "host@example.com",
            createdAt: new Date(),
          },
        },
        upsert: true,
      },
    }));

    const result = await studios.bulkWrite(operations);

    console.log(`Database: ${dbName}`);
    console.log(`New sample studios added: ${result.upsertedCount}`);
    console.log(`Sample studios already present: ${result.matchedCount}`);
  } finally {
    await client.close();
  }
}

seedStudios().catch((error: Error) => {
  console.error(`Studio seed failed: ${error.message}`);
  process.exitCode = 1;
});
