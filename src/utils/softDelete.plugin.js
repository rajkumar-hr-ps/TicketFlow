export const softDeletePlugin = (schema) => {
  schema.add({ deleted_at: { type: Date, default: null } });

  schema.statics.findActive = function (filter = {}) {
    return this.find({ ...filter, deleted_at: null });
  };

  schema.statics.findOneActive = function (filter = {}) {
    return this.findOne({ ...filter, deleted_at: null });
  };

  schema.statics.countActive = function (filter = {}) {
    return this.countDocuments({ ...filter, deleted_at: null });
  };
};
