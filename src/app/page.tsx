import AppBar from "@/components/AppBar";
import CardArtView from "@/components/CardArtView";
import { CardTextView } from "@/components/CardTextView";
import SearchPanel from "@/components/SearchPanel";
import { useCallback } from "react";

// async function getCard(id: string) {
//   // Use absolute URL for server-side fetching
//   const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
//   const res = await fetch(`${baseUrl}/api/cards/${id}`);

//   if (!res.ok) {
//     // Handle error appropriately
//     throw new Error(`Failed to fetch card: ${res.status}`);
//   }

//   const card = await res.json();
//   console.log("Fetched card:", card);
//   return card;
// }

export default async function Home() {
  // Carnelian orb of dragonkind (just a "normal" card with some symbols)
  // const card = await getCard("f0c07546-c5a1-4dfc-b5e1-d697578a8c11");

  // Tarmogoyf (creature)
  // const card = await getCard("69daba76-96e8-4bcc-ab79-2f00189ad8fb");

  // Spike, tournament grinder (testing phyrexian mana and reminder text)
  // const card = await getCard("b0e90b22-6f43-4e9a-a236-f33191768813");

  // Jace, the mind sculptor (Planeswalker)
  // const card = await getCard("c8817585-0d32-4d56-9142-0d29512e86a9");

  // Fall of the imposter (saga)
  // const card = await getCard("d7de696a-49c2-421d-a86c-bcffd68870c6");

  // Assault // Battery (split card)
  // const card = await getCard("9b2ca0a2-0a18-4d9e-b953-52018af3c65b");

  // Brokkos, Apex of Forever (Mutate)
  // const card = await getCard("c9f07625-fbd8-4581-8568-eb3cfb2a4c1e");

  // Ranger Class (Class card)
  // const card = await getCard("7ca392ca-3219-4694-9a74-aa079c76b91e");

  // Fallaji Dragon Engine (Prototype card)
  // const card = await getCard("f7761ed0-a784-4dfb-ab6c-0f4b9a411cf3");

  // Student of Warfare (Level-up card)
  // const card = await getCard("9f4df9be-324b-458a-9379-ab4aa437a6d2");

  // Amethyst Dragon (adventure card)
  // const card = await getCard("57adbd6e-88ec-4472-a9c9-90b679fa881f");

  // Jace, Vryn's Prodigy // Jace, Telepath Unbound (transforming card)
  // const card = await getCard("02d6d693-f1f3-4317-bcc0-c21fa8490d38");

  // TODO Other card types to check: Planar cards, dungeon cards

  return (
    <div className="min-h-screen bg-background">
      <AppBar />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <SearchPanel />
      </main>
    </div>
  );
}
