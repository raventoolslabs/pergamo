import sequelize from '@/infrastructure/db/client';
import { TransactionScope, UnitOfWork } from '@/app/ports/unit-of-work';

export const sequelizeUnitOfWork:UnitOfWork = {

  async run<T>(work:(scope:TransactionScope) => Promise<T>):Promise<T> {

    const transaction = await sequelize.transaction();

    try {

      const result = await work(transaction);

      await transaction.commit();

      return result;

    } catch(error) {

      await transaction.rollback();

      throw error;
    }
  }
};
