"use client";

import { ICard } from "@/types/ICard";
import clsx from "clsx";
import { useState } from "react";

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
  if (!imageUri) {
    return (
      <div
        className="bg-gray-200 flex items-center justify-center text-gray-500"
        style={{ width, height }}
      >
        No image available{alt !== "" && ` for ${alt}`}
      </div>
    );
  }

  return <img src={imageUri} alt={alt} width={width} height={height} />;
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
      <div className={clsx("flex flex-col gap-2", className)}>
        <div onClick={handleFlip} className="cursor-pointer relative group inline-block">
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
    <div className={clsx("flex flex-col gap-2", className)}>
      {imagesToRender.map((image, index) => (
        <div key={index} className="inline-block">
          <CardImage {...image} />
        </div>
      ))}
    </div>
  );
}
