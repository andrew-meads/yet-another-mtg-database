"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { X, Home } from "lucide-react";
import HomeTab from "@/components/my-cards-page/HomeTab";
import { useCreateCollection } from "@/hooks/useCreateCollection";
import { CollectionSummary, CollectionType } from "@/types/CardCollection";
import CollectionTab from "@/components/my-cards-page/CollectionTab";
import { getCollectionIcon } from "@/lib/collectionUtils";

interface Tab {
  id: string;
  title: string;
  closeable: boolean;
  collectionType?: CollectionType;
}

export default function Page() {
  const [tabs, setTabs] = useState<Tab[]>([{ id: "home", title: "Home", closeable: false }]);
  const [activeTab, setActiveTab] = useState("home");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const createCollectionMutation = useCreateCollection();

  const addTab = (id: string, title: string, collectionType?: CollectionType) => {
    // Add new tab if one with that id doesn't already exist
    if (tabs.findIndex((t) => t.id === id) === -1)
      setTabs((prevTabs) => [...prevTabs, { id, title, closeable: true, collectionType }]);

    setActiveTab(id);
  };

  const handleNewCollection = (data: {
    name: string;
    description: string;
    collectionType: CollectionType;
  }) => {
    createCollectionMutation.mutate(data, {
      onSuccess: (response) => {
        addTab(response.collection._id, response.collection.name, response.collection.collectionType);
      },
      onError: (error) => {
        // Show error dialog
        setErrorMessage(error.message || "Failed to create collection");
      }
    });
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

  const handleCollectionClicked = (collection: CollectionSummary) => {
    // console.log("Collection clicked:", collection);
    addTab(collection._id, collection.name, collection.collectionType);
  };

  return (
    <div className="flex-1 flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
        <TabsList className="w-full justify-start h-auto">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id} className="relative group flex-none">
              <span className="flex items-center gap-1.5">
                {tab.id === "home" ? (
                  <Home className="h-4 w-4" />
                ) : tab.collectionType ? (
                  getCollectionIcon(tab.collectionType)
                ) : null}
                <span>{tab.title}</span>
              </span>
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
          <HomeTab
            onNewCollection={handleNewCollection}
            onCollectionClicked={handleCollectionClicked}
            isCreating={createCollectionMutation.isPending}
          />
        </TabsContent>

        {tabs
          .filter((t) => t.id !== "home")
          .map((tab) => (
            <TabsContent key={tab.id} value={tab.id} className="flex-1 p-6">
              <CollectionTab collectionId={tab.id} />
            </TabsContent>
          ))}
      </Tabs>

      <AlertDialog open={!!errorMessage} onOpenChange={(open) => !open && setErrorMessage(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Failed to Create Collection</AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setErrorMessage(null)}>Close</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
