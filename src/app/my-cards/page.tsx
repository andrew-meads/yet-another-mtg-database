"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { X } from "lucide-react";
import HomeTab from "@/components/my-cards-page/HomeTab";

interface Tab {
  id: string;
  title: string;
  closeable: boolean;
}

export default function Page() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "home", title: "Home", closeable: false }]);
  const [activeTab, setActiveTab] = useState("home");

  const handleNewCollection = (data: {
    name: string;
    description: string;
    collectionType: "collection" | "wishlist" | "deck";
  }) => {
    const newTab: Tab = {
      id: `${data.collectionType}-${Date.now()}`,
      title: data.name,
      closeable: true
    };
    setTabs([...tabs, newTab]);
    setActiveTab(newTab.id);
  };

  const handleCloseTab = (tabId: string) => {
    const tabToClose = tabs.find((t) => t.id === tabId);
    if (tabToClose?.closeable) {
      const newTabs = tabs.filter((t) => t.id !== tabId);
      setTabs(newTabs);

      // If closing the active tab, switch to home
      if (activeTab === tabId) {
        setActiveTab("home");
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="relative group">
              <span>{tab.title}</span>
              {tab.closeable && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className="ml-2 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
                  aria-label="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="home" className="flex-1 p-6">
          <HomeTab onNewCollection={handleNewCollection} />
        </TabsContent>

        {tabs
          .filter((t) => t.id !== "home")
          .map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="flex-1 p-6">
              <div className="max-w-4xl mx-auto">
                <h2 className="text-2xl font-bold mb-4">{tab.title}</h2>
                <p className="text-muted-foreground">
                  This is a dummy tab. Collection/deck content will go here.
                </p>
              </div>
            </TabsContent>
          ))}
      </Tabs>
    </div>
  );
}
