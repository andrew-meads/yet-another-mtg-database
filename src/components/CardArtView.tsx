"use client";

import { ICard } from "@/types/ICard";
import clsx from "clsx";
import { useState } from "react";
import Image from "next/image";

type ImageVariant = "png" | "border_crop" | "large" | "normal" | "small";

interface CardArtViewProps {
  card: ICard;
  variant: ImageVariant;
  className?: string;
  flippable?: boolean;
}

const IMAGE_DIMENSIONS: Record<ImageVariant, { width: number; height: number }> = {
  png: { width: 745, height: 1040 },
  border_crop: { width: 480, height: 680 },
  large: { width: 672, height: 936 },
  normal: { width: 488, height: 680 },
  small: { width: 146, height: 204 }
};

interface CardImageProps {
  imageUri: string | undefined;
  alt: string;
  width: number;
  height: number;
}

function CardImage({ imageUri, alt, width, height }: CardImageProps) {
  // Render a container that allows the image to scale down to fit its parent height
  if (!imageUri) {
    return (
      <div
        className="bg-gray-200 flex items-center justify-center text-gray-500 h-full"
        style={{ height: "100%", aspectRatio: `${width} / ${height}` }}
      >
        No image available{alt !== "" && ` for ${alt}`}
      </div>
    );
  }

  // Use Next/Image with fill, contained within a box sized by height + aspect-ratio
  return (
    <div className="relative h-full" style={{ aspectRatio: `${width} / ${height}` }}>
      <Image
        src={imageUri}
        alt={alt}
        fill
        className="object-contain"
        sizes="(max-width: 640px) 40vw, (max-width: 1024px) 25vw, 286px"
        priority={false}
      />
    </div>
  );
}

export default function CardArtView({
  card,
  variant,
  className,
  flippable = false
}: CardArtViewProps) {
  const [currentFaceIndex, setCurrentFaceIndex] = useState(0);
  const dimensions = IMAGE_DIMENSIONS[variant];

  // Check if card faces have their own images (e.g., MDFCs, transforming cards)
  const cardFaces = card.card_faces;
  const hasFaceImages = cardFaces && cardFaces.length > 0 && cardFaces[0].image_uris;

  let images: CardImageProps[];

  if (hasFaceImages) {
    images = cardFaces.map((face) => ({
      imageUri: face.image_uris?.[variant],
      alt: face.name,
      width: dimensions.width,
      height: dimensions.height
    }));
  } else {
    images = [
      {
        imageUri: card.image_uris?.[variant],
        alt: card.name,
        width: dimensions.width,
        height: dimensions.height
      }
    ];
  }

  const isMultiFaced = images.length > 1;
  const shouldBeFlippable = flippable && isMultiFaced;

  const handleFlip = () => {
    if (shouldBeFlippable) {
      setCurrentFaceIndex((prev) => (prev + 1) % images.length);
    }
  };

  // If flippable and multi-faced, render all faces stacked
  const imagesToRender = shouldBeFlippable ? images : images;

  if (shouldBeFlippable) {
    return (
      <div className={clsx("flex flex-col gap-2 h-full items-center justify-center", className)}>
        <div onClick={handleFlip} className="cursor-pointer relative group inline-block h-full">
          {images.map((image, index) => (
            <div
              key={index}
              className="transition-opacity duration-800"
              style={{
                position: index === 0 ? "relative" : "absolute",
                top: index === 0 ? "auto" : 0,
                left: index === 0 ? "auto" : 0,
                opacity: currentFaceIndex === index ? 1 : 0
              }}
            >
              <CardImage {...image} />
            </div>
          ))}
          <div className="absolute inset-0 bg-gray-700/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-semibold text-lg pointer-events-none">
            Click to flip
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-row gap-2 h-full items-center justify-center", className)}>
      {imagesToRender.map((image, index) => (
        <div key={index} className="inline-block h-full">
          <CardImage {...image} />
        </div>
      ))}
    </div>
  );
}
