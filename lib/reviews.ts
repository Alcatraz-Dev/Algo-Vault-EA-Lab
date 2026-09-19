import { adminDatabase } from "@/lib/firebase-admin";

export type ProductRating = {
    average: number;
    count: number;
    distribution: {
        1: number;
        2: number;
        3: number;
        4: number;
        5: number;
    };
    updatedAt: number;
};

export async function recalculateProductRating(
    productId: string
): Promise<ProductRating> {
    const reviewsSnapshot = await adminDatabase
        .ref("reviews")
        .once("value");
    const data = reviewsSnapshot.val() || {};

    const distribution = {
        1: 0,
        2: 0,
        3: 0,
        4: 0,
        5: 0,
    };

    let count = 0;
    let totalRating = 0;

    Object.values(data).forEach((value: any) => {
        if (
            value?.productId !== productId ||
            value?.status !== "published"
        ) {
            return;
        }

        const rating = Number(value?.rating);

        if (
            !Number.isInteger(rating) ||
            rating < 1 ||
            rating > 5
        ) {
            return;
        }

        count += 1;
        totalRating += rating;
        distribution[
            rating as 1 | 2 | 3 | 4 | 5
        ] += 1;
    });

    const average =
        count > 0
            ? Number((totalRating / count).toFixed(1))
            : 0;

    const rating: ProductRating = {
        average,
        count,
        distribution,
        updatedAt: Date.now(),
    };

    await adminDatabase
        .ref(`bots/${productId}/rating`)
        .set(rating);

    return rating;
}